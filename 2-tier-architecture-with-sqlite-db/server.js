const express = require('express');
const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { 
    EC2Client, 
    DescribeInstancesCommand, 
    StopInstancesCommand, 
    StartInstancesCommand, 
    RebootInstancesCommand, 
    TerminateInstancesCommand, 
    CreateSecurityGroupCommand, 
    AuthorizeSecurityGroupIngressCommand, 
    DescribeKeyPairsCommand, 
    DescribeVpcsCommand, 
    DescribeSecurityGroupsCommand, 
    DescribeImagesCommand,
    CreateKeyPairCommand // Included for Dynamic Key Creation
} = require("@aws-sdk/client-ec2");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public', { extensions: ['html'] }));
// --- Health Check Probe ---
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'UP', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});



const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const keysDir = path.join(dataDir, 'keys');
const tfDir = path.join(dataDir, 'terraform_workspaces');
if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir);
if (!fs.existsSync(tfDir)) fs.mkdirSync(tfDir);

const db = new sqlite3.Database(path.join(dataDir, 'app_data.db'), (err) => {
    if (err) console.error(err.message);
    console.log('Connected to the SQLite database.');
});

// Initialize Database Tables
db.run(`CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, vpc_cidr TEXT, subnet_cidr TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
db.run(`CREATE TABLE IF NOT EXISTS ssh_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, key_name TEXT, file_path TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS ssh_data (username TEXT PRIMARY KEY, hosts TEXT, usernames TEXT, history TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS aws_credentials (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, alias TEXT, access_key TEXT, secret_key TEXT, region TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS aws_sgs (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, cred_id INTEGER, sg_name TEXT, sg_id TEXT, region TEXT)`);

// --- Standard APIs (CIDR History) ---
app.post('/api/save', (req, res) => {
    const user = (req.body.username || "").toLowerCase();
    db.run(`INSERT INTO history (username, vpc_cidr, subnet_cidr) VALUES (?, ?, ?)`, [user, req.body.vpc_cidr, req.body.subnet_cidr], function(err) {
        if (err) return res.status(500).send(err.message); 
        res.status(200).json({ id: this.lastID });
    });
});

app.get('/api/history/:username', (req, res) => { 
    db.all(`SELECT * FROM history WHERE username = ? ORDER BY timestamp DESC`, [req.params.username.toLowerCase()], (err, rows) => {
        res.json(rows);
    }); 
});

app.delete('/api/history/:id', (req, res) => { 
    db.run(`DELETE FROM history WHERE id = ?`, [req.params.id], function(err) { 
        res.status(200).send("History deleted."); 
    }); 
});

// --- Standard APIs (SSH Layouts & Users) ---
app.get('/api/ssh-data/:username', (req, res) => {
    db.get(`SELECT hosts, usernames, history FROM ssh_data WHERE username = ?`, [req.params.username.toLowerCase()], (err, row) => {
        if (row) {
            res.json({ 
                hosts: JSON.parse(row.hosts || '[]'), 
                usernames: JSON.parse(row.usernames || '[]'), 
                history: JSON.parse(row.history || '[]') 
            });
        } else {
            res.json({ hosts: [], usernames: [], history: [] });
        }
    });
});

app.post('/api/ssh-data', (req, res) => {
    const { hosts, usernames, history } = req.body;
    db.run(`INSERT OR REPLACE INTO ssh_data (username, hosts, usernames, history) VALUES (?, ?, ?, ?)`, 
    [(req.body.username || "").toLowerCase(), JSON.stringify(hosts), JSON.stringify(usernames), JSON.stringify(history)], 
    function(err) { 
        if (err) return res.status(500).send(err.message);
        res.status(200).send("Saved."); 
    });
});

// --- Standard APIs (SSH PEM Keys) ---
const upload = multer({ dest: 'keys/' });

app.post('/api/upload-key', upload.single('privateKey'), (req, res) => {
    try { 
        fs.chmodSync(req.file.path, 0o400); 
        db.run(`INSERT INTO ssh_keys (username, key_name, file_path) VALUES (?, ?, ?)`, 
        [(req.body.username || "").toLowerCase(), req.body.keyName, req.file.path], 
        function(err) { 
            if (err) return res.status(500).send(err.message);
            res.status(200).json({ message: "Key saved." }); 
        });
    } catch (error) { 
        res.status(500).send("Failed to set key permissions."); 
    }
});

app.get('/api/keys/:username', (req, res) => { 
    db.all(`SELECT id, key_name, file_path FROM ssh_keys WHERE username = ?`, [req.params.username.toLowerCase()], (err, rows) => {
        res.json(rows);
    }); 
});

app.delete('/api/keys/:id', (req, res) => {
    db.get(`SELECT file_path FROM ssh_keys WHERE id = ?`, [req.params.id], (err, row) => {
        if (row) { 
            try { fs.unlinkSync(row.file_path); } catch(e) {} 
            db.run(`DELETE FROM ssh_keys WHERE id = ?`, [req.params.id], (err) => { 
                res.status(200).send("Key deleted."); 
            }); 
        }
    });
});

app.delete('/api/keys/all/:username', (req, res) => {
    const user = req.params.username.toLowerCase();
    db.all(`SELECT file_path FROM ssh_keys WHERE username = ?`, [user], (err, rows) => {
        if (err) return res.status(500).send(err.message);
        rows.forEach(row => { 
            try { fs.unlinkSync(row.file_path); } catch(e) {} 
        });
        db.run(`DELETE FROM ssh_keys WHERE username = ?`, [user], (err) => { 
            res.status(200).send("All keys deleted."); 
        });
    });
});

// --- AWS Credentials & Security Group Reference APIs ---
app.post('/api/aws-creds', (req, res) => {
    const { username, alias, access_key, secret_key } = req.body;
    db.run(`INSERT INTO aws_credentials (username, alias, access_key, secret_key, region) VALUES (?, ?, ?, ?, ?)`, 
    [username.toLowerCase(), alias, access_key, secret_key, "Global"], function(err) {
        if (err) return res.status(500).send(err.message); 
        res.status(200).send("Creds saved.");
    });
});

app.get('/api/aws-creds/:username', (req, res) => { 
    db.all(`SELECT id, alias, access_key FROM aws_credentials WHERE username = ?`, [req.params.username.toLowerCase()], (err, rows) => {
        res.json(rows);
    }); 
});

app.delete('/api/aws-creds/:id', (req, res) => { 
    db.run(`DELETE FROM aws_credentials WHERE id = ?`, [req.params.id], (err) => { 
        res.status(200).send("Deleted."); 
    }); 
});

app.get('/api/aws-sgs/:username', (req, res) => { 
    db.all(`SELECT * FROM aws_sgs WHERE username = ?`, [req.params.username.toLowerCase()], (err, rows) => {
        res.json(rows);
    }); 
});

// --- AWS Dynamic Key Pair Creator ---
app.post('/api/aws-create-keypair', (req, res) => {
    const { username, credId, region, keyName } = req.body;
    
    db.get(`SELECT * FROM aws_credentials WHERE id = ? AND username = ?`, [credId, username.toLowerCase()], async (err, creds) => {
        if (err || !creds) return res.status(404).send("Credentials not found.");

        try {
            const client = new EC2Client({ region: region, credentials: { accessKeyId: creds.access_key, secretAccessKey: creds.secret_key } });
            
            // Instruct AWS to generate the Key Pair
            const command = new CreateKeyPairCommand({ KeyName: keyName });
            const response = await client.send(command);

            // Save the Private Key material to the local data/keys directory securely
            const safeKeyName = keyName.replace(/[^a-zA-Z0-9_-]/g, '');
            const fileName = `aws_${Date.now()}_${safeKeyName}.pem`;
            const filePath = path.join(keysDir, fileName);
            
            // Save with strictly isolated read-only permissions (0o400) required by SSH
            fs.writeFileSync(filePath, response.KeyMaterial, { mode: 0o400 });

            // Save to SQLite database so it shows up in the SSH tool
            db.run(`INSERT INTO ssh_keys (username, key_name, file_path) VALUES (?, ?, ?)`, 
            [(username || "").toLowerCase(), keyName, filePath], function(insertErr) {
                if (insertErr) return res.status(500).send(insertErr.message);
                
                // Return both the success message and the raw key material for browser download
                res.status(200).json({ 
                    message: "Key Pair created successfully.", 
                    keyName: keyName,
                    keyMaterial: response.KeyMaterial 
                });
            });
        } catch (error) { 
            res.status(500).send(error.message); 
        }
    });
});

// --- AWS Region Data Fetcher (Keys, SGs, AMIs) ---
app.get('/api/aws-region-data', (req, res) => {
    const { username, credId, region } = req.query;
    if(!credId || !region) return res.json({ keyPairs: [], securityGroups: [], customAmis: [] });
    
    db.get(`SELECT * FROM aws_credentials WHERE id = ? AND username = ?`, [credId, username.toLowerCase()], async (err, creds) => {
        if (err || !creds) return res.status(404).send("Credentials not found.");
        
        try {
            const client = new EC2Client({ region: region, credentials: { accessKeyId: creds.access_key, secretAccessKey: creds.secret_key } });
            
            const keyData = await client.send(new DescribeKeyPairsCommand({}));
            const keyPairs = keyData.KeyPairs.map(k => k.KeyName);

            let securityGroups = [];
            const vpcData = await client.send(new DescribeVpcsCommand({ Filters: [{ Name: "isDefault", Values: ["true"] }] }));
            if (vpcData.Vpcs && vpcData.Vpcs.length > 0) {
                const defaultVpcId = vpcData.Vpcs[0].VpcId;
                const sgData = await client.send(new DescribeSecurityGroupsCommand({ Filters: [{ Name: "vpc-id", Values: [defaultVpcId] }] }));
                securityGroups = sgData.SecurityGroups.map(sg => ({ id: sg.GroupId, name: sg.GroupName }));
            }

            const amiData = await client.send(new DescribeImagesCommand({ Owners: ["self"] }));
            const customAmis = (amiData.Images || []).map(img => ({ id: img.ImageId, name: img.Name || img.ImageId }));

            res.json({ keyPairs, securityGroups, customAmis });
        } catch (error) { 
            res.status(500).send(error.message); 
        }
    });
});

// --- EC2 Status Poller for Progress Bar ---
app.get('/api/ec2-status', (req, res) => {
    const { username, credId, instanceId, region } = req.query;
    db.get(`SELECT * FROM aws_credentials WHERE id = ? AND username = ?`, [credId, username.toLowerCase()], async (err, creds) => {
        if (err || !creds) return res.status(404).send("Credentials not found.");
        
        try {
            const client = new EC2Client({ region: region, credentials: { accessKeyId: creds.access_key, secretAccessKey: creds.secret_key } });
            const desc = await client.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
            const instance = desc.Reservations[0].Instances[0];
            res.status(200).json({ state: instance.State.Name, ip: instance.PublicIpAddress });
        } catch (error) { 
            res.status(500).send(error.message); 
        }
    });
});

// --- EC2 Power Management (AWS SDK) ---
app.post('/api/ec2-power', (req, res) => {
    const { username, credId, identifier, action, region } = req.body; 

    db.get(`SELECT * FROM aws_credentials WHERE id = ? AND username = ?`, [credId, username.toLowerCase()], async (err, creds) => {
        if (err || !creds) return res.status(404).send("Credentials not found.");
        
        try {
            const client = new EC2Client({ region: region, credentials: { accessKeyId: creds.access_key, secretAccessKey: creds.secret_key } });
            let instanceId = identifier;

            if (identifier.includes('.')) {
                const desc = await client.send(new DescribeInstancesCommand({ Filters: [{ Name: "ip-address", Values: [identifier] }] }));
                if (!desc.Reservations.length || !desc.Reservations[0].Instances.length) {
                    return res.status(404).send("Instance not found by Public IP in this region.");
                }
                instanceId = desc.Reservations[0].Instances[0].InstanceId;
            }

            if (action === 'stop') await client.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
            if (action === 'start') await client.send(new StartInstancesCommand({ InstanceIds: [instanceId] }));
            if (action === 'restart') await client.send(new RebootInstancesCommand({ InstanceIds: [instanceId] }));
            if (action === 'terminate') await client.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));

            res.status(200).json({ message: `Instance ${action} initiated.`, instanceId: instanceId });
        } catch (error) { 
            res.status(500).send(error.message); 
        }
    });
});

// --- Terraform EC2 Provisioner ---
app.post('/api/ec2-provision', (req, res) => {
    const { username, credId, osType, customAmi, instanceType, awsKeyName, sgSelectionType, existingSgId, sgProtocol, sgPorts, storageSize, region } = req.body;

    db.get(`SELECT * FROM aws_credentials WHERE id = ? AND username = ?`, [credId, username.toLowerCase()], async (err, creds) => {
        if (err || !creds) return res.status(404).send("Credentials not found.");

        const client = new EC2Client({ region: region, credentials: { accessKeyId: creds.access_key, secretAccessKey: creds.secret_key } });
        let finalSgId = existingSgId; 

        try {
            if (sgSelectionType === 'create-default' || sgSelectionType === 'create-custom') {
                const uniqueSuffix = Math.random().toString(36).substring(2, 7);
                const sgName = sgSelectionType === 'create-default' ? `sidorea-default-${uniqueSuffix}` : `sidorea-custom-ports-${uniqueSuffix}`;
                
                const createRes = await client.send(new CreateSecurityGroupCommand({ GroupName: sgName, Description: "Managed by Sidorea Platform" }));
                finalSgId = createRes.GroupId;
                
                let ipPerms = [];
                if (sgSelectionType === 'create-default') {
                    ipPerms.push({ IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }] });
                } else {
                    ipPerms.push({ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] });
                    if (sgPorts) {
                        const ports = sgPorts.split(',').map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p !== 22);
                        ports.forEach(p => {
                            ipPerms.push({ IpProtocol: sgProtocol.toLowerCase(), FromPort: p, ToPort: p, IpRanges: [{ CidrIp: '0.0.0.0/0' }] });
                        });
                    }
                }
                
                await client.send(new AuthorizeSecurityGroupIngressCommand({ GroupId: finalSgId, IpPermissions: ipPerms }));
                
                await new Promise(resolve => {
                    db.run(`INSERT INTO aws_sgs (username, cred_id, sg_name, sg_id, region) VALUES (?, ?, ?, ?, ?)`, 
                    [username.toLowerCase(), credId, sgName, finalSgId, region], resolve);
                });
            }

            const workspace = path.join(tfDir, `workspace_${Date.now()}`);
            fs.mkdirSync(workspace);

            let dataBlock = "";
            let amiAssignment = "";
            
            if (osType === 'my-ami' || osType === 'custom') { 
                amiAssignment = `ami = "${customAmi}"`; 
            } else {
                let filterName = ""; let owner = "";
                
                if (osType === 'ubuntu26') { filterName = "ubuntu/images/hvm-ssd*/ubuntu-*-26.04-amd64-server-*"; owner = "099720109477"; }
                else if (osType === 'ubuntu24') { filterName = "ubuntu/images/hvm-ssd*/ubuntu-noble-24.04-amd64-server-*"; owner = "099720109477"; }
                else if (osType === 'ubuntu22') { filterName = "ubuntu/images/hvm-ssd*/ubuntu-jammy-22.04-amd64-server-*"; owner = "099720109477"; }
                else if (osType === 'rhel10') { filterName = "RHEL-10*x86_64*"; owner = "301981543114"; }
                else if (osType === 'rhel9') { filterName = "RHEL-9*x86_64*"; owner = "301981543114"; }
                else if (osType === 'amazon2023') { filterName = "al2023-ami-2023*-x86_64"; owner = "137112412989"; } 

                dataBlock = `
data "aws_ami" "selected" {
  most_recent = true
  owners      = ["${owner}"]
  filter {
    name   = "name"
    values = ["${filterName}"]
  }
}
`;
                amiAssignment = `ami = data.aws_ami.selected.id`;
            }

            const tfConfig = `
provider "aws" {
  region     = "${region}"
  access_key = "${creds.access_key}"
  secret_key = "${creds.secret_key}"
}

${dataBlock}

resource "aws_instance" "web" {
  ${amiAssignment}
  instance_type          = "${instanceType || 't2.micro'}"
  key_name               = "${awsKeyName}"
  vpc_security_group_ids = ["${finalSgId}"]
  
  root_block_device { 
    volume_size = ${storageSize || 8}
    volume_type = "gp3" 
  }
  
  tags = { 
    Name = "Sidorea-Provisioned-${osType}" 
  }
}

output "instance_ip" {
  value = aws_instance.web.public_ip
}

output "instance_id" {
  value = aws_instance.web.id
}
`;
            fs.writeFileSync(path.join(workspace, 'main.tf'), tfConfig);

            exec('terraform init && terraform apply -auto-approve', { cwd: workspace }, (error, stdout, stderr) => {
                if (error) return res.status(500).send(`Terraform Error:\n${stderr}`);
                
                exec('terraform output -json', { cwd: workspace }, (err2, out2, stderr2) => {
                    if (err2) return res.status(500).send("Failed to parse Terraform output.");
                    try {
                        const outputs = JSON.parse(out2);
                        res.status(200).json({ 
                            message: "Instance provisioned successfully!", 
                            ip: outputs.instance_ip.value, 
                            id: outputs.instance_id.value 
                        });
                    } catch(e) { 
                        res.status(500).send("Error reading provisioned IP."); 
                    }
                });
            });

        } catch (err) { 
            res.status(500).send(`Pre-Provisioning Error: ${err.message}`); 
        }
    });
});

// --- Real-time SSH WebSocket Logic ---
io.on('connection', (socket) => {
    let sshConn = new Client();
    let isConnected = false;

    socket.on('start-ssh', (data) => {
        const { host, user, keyPath, cols = 80, rows = 24 } = data;
        
        if (!fs.existsSync(keyPath)) return socket.emit('ssh-error', 'Private key file is missing.');
        
        sshConn.on('ready', () => {
            isConnected = true; 
            // FIXED: Cleaned up the connection success message!
            socket.emit('ssh-status', 'Connected!');
            
            sshConn.shell({ term: 'xterm-256color', cols: cols, rows: rows }, (err, stream) => {
                if (err) return socket.emit('ssh-error', err.message);
                
                socket.on('resize', ({ cols, rows }) => {
                    if (stream && stream.setWindow) {
                        stream.setWindow(rows, cols, 0, 0);
                    }
                });

                socket.on('terminal-input', (input) => {
                    stream.write(input);
                });
                
                stream.on('data', (output) => {
                    socket.emit('terminal-output', output.toString('utf-8'));
                });
                
                stream.on('close', () => { 
                    isConnected = false; 
                    sshConn.end(); 
                    socket.emit('ssh-status', 'Connection closed.'); 
                });
            });

            const statCmd = `while true; do cores=$(nproc 2>/dev/null || echo 1); load=$(cat /proc/loadavg 2>/dev/null | awk '{print $1}'); [ -z "$load" ] && load="0.00"; cpu=$(awk -v a="$load" -v b="$cores" 'BEGIN { printf "%.1f", (a/b)*100 }'); mem=$(free -m 2>/dev/null | awk '/Mem:/ {print $3"|"$2}'); [ -z "$mem" ] && mem="0|0"; disk=$(df -Ph / 2>/dev/null | tail -1 | awk '{print $3"|"$2"|"$5"|"$4}'); [ -z "$disk" ] && disk="0|0|0|0"; echo "$cpu|$cores|$mem|$disk"; sleep 3; done`;
            
            sshConn.exec(statCmd, (err, stream) => {
                if (!err) {
                    stream.on('data', (chunk) => {
                        const lines = chunk.toString().trim().split('\n');
                        if (lines[lines.length - 1]) {
                            socket.emit('stat-update', lines[lines.length - 1].trim());
                        }
                    });
                }
            });
            
        }).on('error', (err) => { 
            isConnected = false; 
            let errorMsg = err.message;
            if (errorMsg.includes('handshake') || errorMsg.includes('Connection lost')) {
                errorMsg += " (Server OS is likely still booting up. Wait 45s and click Refresh)";
            }
            socket.emit('ssh-error', `Connection failed: ${errorMsg}`);
            
        }).on('close', () => { 
            if (isConnected) {
                socket.emit('ssh-error', 'Connection lost.'); 
            }
            isConnected = false;
        }).connect({ 
            host: host, 
            port: 22, 
            username: user, 
            privateKey: fs.readFileSync(keyPath), 
            readyTimeout: 15000 
        });

        socket.on('sftp-upload', (fileDataPayload) => {
            if (!isConnected) return;
            sshConn.sftp((err, sftp) => {
                const writeStream = sftp.createWriteStream(fileDataPayload.remotePath);
                writeStream.on('close', () => {
                    socket.emit('sftp-success', `Upload complete`);
                });
                writeStream.write(Buffer.from(fileDataPayload.fileData)); 
                writeStream.end();
            });
        });

        socket.on('sftp-download', (remotePath) => {
            if (!isConnected) return;
            sshConn.sftp((err, sftp) => {
                sftp.readFile(remotePath, (err, data) => {
                    socket.emit('sftp-download-ready', { 
                        fileData: data, 
                        fileName: remotePath.split('/').pop() 
                    });
                });
            });
        });
    });
    
    socket.on('disconnect', () => { 
        isConnected = false; 
        sshConn.end(); 
    });
});

server.listen(3000, () => { 
    console.log('Server running on port 3000.'); 
});
