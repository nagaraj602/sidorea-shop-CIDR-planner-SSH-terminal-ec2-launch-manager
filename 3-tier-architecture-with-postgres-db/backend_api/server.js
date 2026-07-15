require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Pool } = require('pg');
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { 
    EC2Client, DescribeInstancesCommand, StopInstancesCommand, 
    StartInstancesCommand, RebootInstancesCommand, TerminateInstancesCommand, 
    CreateSecurityGroupCommand, AuthorizeSecurityGroupIngressCommand, 
    DescribeKeyPairsCommand, DescribeVpcsCommand, 
    DescribeSecurityGroupsCommand, DescribeImagesCommand 
} = require("@aws-sdk/client-ec2");

const app = express();
const server = http.createServer(app);

// Allow CORS for front-end separation
app.use(cors());
app.use(express.json());

const io = new Server(server, {
    cors: { origin: '*', methods: ["GET", "POST"] }
});

// --- Health Check Probe (Useful for K8s) ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// --- File System Setup ---
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const keysDir = path.join(dataDir, 'keys');
const tfDir = path.join(dataDir, 'terraform_workspaces');
if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir);
if (!fs.existsSync(tfDir)) fs.mkdirSync(tfDir);

// --- PostgreSQL Setup ---
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const initDb = async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS history (id SERIAL PRIMARY KEY, username VARCHAR(255), vpc_cidr VARCHAR(50), subnet_cidr VARCHAR(50), timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS ssh_keys (id SERIAL PRIMARY KEY, username VARCHAR(255), key_name VARCHAR(255), file_path TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS ssh_data (username VARCHAR(255) PRIMARY KEY, hosts TEXT, usernames TEXT, history TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS aws_credentials (id SERIAL PRIMARY KEY, username VARCHAR(255), alias VARCHAR(255), access_key VARCHAR(255), secret_key VARCHAR(255), region VARCHAR(100))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS aws_sgs (id SERIAL PRIMARY KEY, username VARCHAR(255), cred_id INTEGER, sg_name VARCHAR(255), sg_id VARCHAR(255), region VARCHAR(100))`);
        console.log('Connected to PostgreSQL and verified tables.');
    } catch (err) {
        console.error('Database initialization failed:', err);
    }
};
initDb();

// --- Standard APIs (CIDR History) ---
app.post('/api/save', async (req, res) => {
    const user = (req.body.username || "").toLowerCase();
    try {
        const result = await pool.query(`INSERT INTO history (username, vpc_cidr, subnet_cidr) VALUES ($1, $2, $3) RETURNING id`, [user, req.body.vpc_cidr, req.body.subnet_cidr]);
        res.status(200).json({ id: result.rows[0].id });
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/history/:username', async (req, res) => { 
    try {
        const result = await pool.query(`SELECT * FROM history WHERE username = $1 ORDER BY timestamp DESC`, [req.params.username.toLowerCase()]);
        res.json(result.rows);
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/api/history/:id', async (req, res) => { 
    try {
        await pool.query(`DELETE FROM history WHERE id = $1`, [req.params.id]);
        res.status(200).send("History deleted."); 
    } catch (err) { res.status(500).send(err.message); }
});

// --- Standard APIs (SSH Layouts & Users) ---
app.get('/api/ssh-data/:username', async (req, res) => {
    try {
        const result = await pool.query(`SELECT hosts, usernames, history FROM ssh_data WHERE username = $1`, [req.params.username.toLowerCase()]);
        if (result.rows.length > 0) {
            const row = result.rows[0];
            res.json({ hosts: JSON.parse(row.hosts || '[]'), usernames: JSON.parse(row.usernames || '[]'), history: JSON.parse(row.history || '[]') });
        } else {
            res.json({ hosts: [], usernames: [], history: [] });
        }
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/ssh-data', async (req, res) => {
    const { hosts, usernames, history } = req.body;
    try {
        await pool.query(
            `INSERT INTO ssh_data (username, hosts, usernames, history) VALUES ($1, $2, $3, $4) 
             ON CONFLICT (username) DO UPDATE SET hosts = EXCLUDED.hosts, usernames = EXCLUDED.usernames, history = EXCLUDED.history`, 
            [(req.body.username || "").toLowerCase(), JSON.stringify(hosts), JSON.stringify(usernames), JSON.stringify(history)]
        );
        res.status(200).send("Saved."); 
    } catch (err) { res.status(500).send(err.message); }
});

// --- Standard APIs (SSH PEM Keys) ---
const upload = multer({ dest: 'data/keys/' });

app.post('/api/upload-key', upload.single('privateKey'), async (req, res) => {
    try { 
        fs.chmodSync(req.file.path, 0o400); 
        await pool.query(`INSERT INTO ssh_keys (username, key_name, file_path) VALUES ($1, $2, $3)`, [(req.body.username || "").toLowerCase(), req.body.keyName, req.file.path]);
        res.status(200).json({ message: "Key saved." }); 
    } catch (error) { res.status(500).send("Failed to save key."); }
});

app.get('/api/keys/:username', async (req, res) => { 
    try {
        const result = await pool.query(`SELECT id, key_name, file_path FROM ssh_keys WHERE username = $1`, [req.params.username.toLowerCase()]);
        res.json(result.rows);
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/api/keys/:id', async (req, res) => {
    try {
        const result = await pool.query(`SELECT file_path FROM ssh_keys WHERE id = $1`, [req.params.id]);
        if (result.rows.length > 0) { 
            try { fs.unlinkSync(result.rows[0].file_path); } catch(e) {} 
            await pool.query(`DELETE FROM ssh_keys WHERE id = $1`, [req.params.id]);
            res.status(200).send("Key deleted."); 
        } else { res.status(404).send("Not found"); }
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/api/keys/all/:username', async (req, res) => {
    const user = req.params.username.toLowerCase();
    try {
        const result = await pool.query(`SELECT file_path FROM ssh_keys WHERE username = $1`, [user]);
        result.rows.forEach(row => { try { fs.unlinkSync(row.file_path); } catch(e) {} });
        await pool.query(`DELETE FROM ssh_keys WHERE username = $1`, [user]);
        res.status(200).send("All keys deleted."); 
    } catch (err) { res.status(500).send(err.message); }
});

// --- AWS Credentials & Security Group Reference APIs ---
app.post('/api/aws-creds', async (req, res) => {
    const { username, alias, access_key, secret_key } = req.body;
    try {
        await pool.query(`INSERT INTO aws_credentials (username, alias, access_key, secret_key, region) VALUES ($1, $2, $3, $4, $5)`, 
        [username.toLowerCase(), alias, access_key, secret_key, "Global"]);
        res.status(200).send("Creds saved.");
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/aws-creds/:username', async (req, res) => { 
    try {
        const result = await pool.query(`SELECT id, alias, access_key FROM aws_credentials WHERE username = $1`, [req.params.username.toLowerCase()]);
        res.json(result.rows);
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/api/aws-creds/:id', async (req, res) => { 
    try {
        await pool.query(`DELETE FROM aws_credentials WHERE id = $1`, [req.params.id]);
        res.status(200).send("Deleted."); 
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/aws-sgs/:username', async (req, res) => { 
    try {
        const result = await pool.query(`SELECT * FROM aws_sgs WHERE username = $1`, [req.params.username.toLowerCase()]);
        res.json(result.rows);
    } catch (err) { res.status(500).send(err.message); }
});

// --- AWS Region Data Fetcher (Keys, SGs, AMIs) ---
app.get('/api/aws-region-data', async (req, res) => {
    const { username, credId, region } = req.query;
    if(!credId || !region) return res.json({ keyPairs: [], securityGroups: [], customAmis: [] });
    
    try {
        const result = await pool.query(`SELECT * FROM aws_credentials WHERE id = $1 AND username = $2`, [credId, username.toLowerCase()]);
        if (result.rows.length === 0) return res.status(404).send("Credentials not found.");
        const creds = result.rows[0];
        
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
    } catch (error) { res.status(500).send(error.message); }
});

// --- EC2 Status Poller for Progress Bar ---
app.get('/api/ec2-status', async (req, res) => {
    const { username, credId, instanceId, region } = req.query;
    try {
        const result = await pool.query(`SELECT * FROM aws_credentials WHERE id = $1 AND username = $2`, [credId, username.toLowerCase()]);
        if (result.rows.length === 0) return res.status(404).send("Credentials not found.");
        const creds = result.rows[0];
        
        const client = new EC2Client({ region: region, credentials: { accessKeyId: creds.access_key, secretAccessKey: creds.secret_key } });
        const desc = await client.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
        const instance = desc.Reservations[0].Instances[0];
        res.status(200).json({ state: instance.State.Name, ip: instance.PublicIpAddress });
    } catch (error) { res.status(500).send(error.message); }
});

// --- EC2 Power Management (AWS SDK) ---
app.post('/api/ec2-power', async (req, res) => {
    const { username, credId, identifier, action, region } = req.body; 

    try {
        const result = await pool.query(`SELECT * FROM aws_credentials WHERE id = $1 AND username = $2`, [credId, username.toLowerCase()]);
        if (result.rows.length === 0) return res.status(404).send("Credentials not found.");
        const creds = result.rows[0];
        
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
    } catch (error) { res.status(500).send(error.message); }
});

// --- Terraform EC2 Provisioner ---
app.post('/api/ec2-provision', async (req, res) => {
    const { username, credId, osType, customAmi, instanceType, awsKeyName, sgSelectionType, existingSgId, sgProtocol, sgPorts, storageSize, region } = req.body;

    try {
        const result = await pool.query(`SELECT * FROM aws_credentials WHERE id = $1 AND username = $2`, [credId, username.toLowerCase()]);
        if (result.rows.length === 0) return res.status(404).send("Credentials not found.");
        const creds = result.rows[0];

        const client = new EC2Client({ region: region, credentials: { accessKeyId: creds.access_key, secretAccessKey: creds.secret_key } });
        let finalSgId = existingSgId; 

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
            await pool.query(`INSERT INTO aws_sgs (username, cred_id, sg_name, sg_id, region) VALUES ($1, $2, $3, $4, $5)`, 
                [username.toLowerCase(), credId, sgName, finalSgId, region]);
        }

        const workspace = path.join(tfDir, `workspace_${Date.now()}`);
        fs.mkdirSync(workspace);

        let dataBlock = ""; let amiAssignment = "";
        
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
                    res.status(200).json({ message: "Instance provisioned successfully!", ip: outputs.instance_ip.value, id: outputs.instance_id.value });
                } catch(e) { res.status(500).send("Error reading provisioned IP."); }
            });
        });

    } catch (err) { res.status(500).send(`Pre-Provisioning Error: ${err.message}`); }
});

// --- Real-time SSH WebSocket Logic (Remains Unchanged) ---
io.on('connection', (socket) => {
    let sshConn = new Client();
    let isConnected = false;

    socket.on('start-ssh', (data) => {
        const { host, user, keyPath, cols = 80, rows = 24 } = data;
        if (!fs.existsSync(keyPath)) return socket.emit('ssh-error', 'Private key file is missing.');
        
        sshConn.on('ready', () => {
            isConnected = true; 
            socket.emit('ssh-status', 'Connected!');
            
            sshConn.shell({ term: 'xterm-256color', cols: cols, rows: rows }, (err, stream) => {
                if (err) return socket.emit('ssh-error', err.message);
                socket.on('resize', ({ cols, rows }) => { if (stream && stream.setWindow) stream.setWindow(rows, cols, 0, 0); });
                socket.on('terminal-input', (input) => { stream.write(input); });
                stream.on('data', (output) => { socket.emit('terminal-output', output.toString('utf-8')); });
                stream.on('close', () => { isConnected = false; sshConn.end(); socket.emit('ssh-status', 'Connection closed.'); });
            });

            const statCmd = `while true; do cores=$(nproc 2>/dev/null || echo 1); load=$(cat /proc/loadavg 2>/dev/null | awk '{print $1}'); [ -z "$load" ] && load="0.00"; cpu=$(awk -v a="$load" -v b="$cores" 'BEGIN { printf "%.1f", (a/b)*100 }'); mem=$(free -m 2>/dev/null | awk '/Mem:/ {print $3"|"$2}'); [ -z "$mem" ] && mem="0|0"; disk=$(df -Ph / 2>/dev/null | tail -1 | awk '{print $3"|"$2"|"$5"|"$4}'); [ -z "$disk" ] && disk="0|0|0|0"; echo "$cpu|$cores|$mem|$disk"; sleep 3; done`;
            sshConn.exec(statCmd, (err, stream) => {
                if (!err) {
                    stream.on('data', (chunk) => {
                        const lines = chunk.toString().trim().split('\n');
                        if (lines[lines.length - 1]) socket.emit('stat-update', lines[lines.length - 1].trim());
                    });
                }
            });
        }).on('error', (err) => { 
            isConnected = false; 
            socket.emit('ssh-error', `Connection failed: ${err.message}`);
        }).on('close', () => { 
            if (isConnected) socket.emit('ssh-error', 'Connection lost.'); 
            isConnected = false;
        }).connect({ host, port: 22, username: user, privateKey: fs.readFileSync(keyPath), readyTimeout: 15000 });

        socket.on('sftp-upload', (fileDataPayload) => {
            if (!isConnected) return;
            sshConn.sftp((err, sftp) => {
                const writeStream = sftp.createWriteStream(fileDataPayload.remotePath);
                writeStream.on('close', () => socket.emit('sftp-success', `Upload complete`));
                writeStream.write(Buffer.from(fileDataPayload.fileData)); 
                writeStream.end();
            });
        });

        socket.on('sftp-download', (remotePath) => {
            if (!isConnected) return;
            sshConn.sftp((err, sftp) => {
                sftp.readFile(remotePath, (err, data) => {
                    socket.emit('sftp-download-ready', { fileData: data, fileName: remotePath.split('/').pop() });
                });
            });
        });
    });
    
    socket.on('disconnect', () => { isConnected = false; sshConn.end(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`API Server running on port ${PORT}.`); });
