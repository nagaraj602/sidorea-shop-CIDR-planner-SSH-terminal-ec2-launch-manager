#!/bin/bash

# Detect Linux Distribution
distro=$(grep "^ID=" /etc/os-release | cut -d= -f2 | tr -d '"')

case "$distro" in
    ubuntu)
        echo "Detected Ubuntu Distro."
        ;;
    debian)
        echo "Detected Debian Distro."
        ;;
    *)
        echo "Unsupported Linux Distribution: $distro. You can have only Ubuntu and Debian"
        exit 1
        ;;
esac

# Update System
echo "🚀 Starting System Update..."
sudo apt-get update >/dev/null 2>&1
sudo apt-get upgrade -y >/dev/null 2>&1

# Install Required Packages (Added dnsutils for 'dig' command)
echo "📦 Installing Required Packages..."
sudo apt install postgresql postgresql-contrib nodejs npm nginx curl wget gnupg software-properties-common ca-certificates apt-transport-https dnsutils -y >/dev/null 2>&1

############################################
# Install Terraform
############################################
echo "🏗️ Installing Terraform..."
if ! command -v terraform >/dev/null; then
    curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor | sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg >/dev/null 2>&1
    echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list >/dev/null 2>&1
    sudo apt-get update >/dev/null 2>&1
    sudo apt-get install -y terraform >/dev/null 2>&1
else
    echo "Terraform already installed."
fi

############################################
# Configure PostgreSQL
############################################
echo "🗄️ Configuring Database..."
sudo systemctl enable postgresql
sudo systemctl start postgresql

sudo -i -u postgres psql -c "CREATE DATABASE sidorea_db;"
sudo -i -u postgres psql -c "CREATE USER sidorea_user WITH ENCRYPTED PASSWORD 'supersecurepassword';"
sudo -i -u postgres psql -c "ALTER DATABASE sidorea_db OWNER TO sidorea_user;"

############################################
# Configure Nginx
############################################
echo "🌐 Configuring Nginx..."
# Fix permissions so Nginx can read the directory
sudo chmod 755 /home/ubuntu

sudo tee /etc/nginx/sites-available/sidorea > /dev/null << 'EOF'
server {
    listen 80;
    server_name localhost;

    location / {
        root /home/ubuntu/sidorea-shop-CIDR-planner-SSH-terminal-ec2-launch-manager/3-tier-architecture-with-postgres-db/frontend_public;
        index index.html;
        try_files $uri $uri.html $uri/ =404;
    }

    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/sidorea /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl restart nginx

############################################
# Install PM2
############################################
echo "⚙️ Installing PM2..."
if ! command -v pm2 >/dev/null 2>&1; then
    sudo npm install -g pm2 >/dev/null 2>&1
else
    echo "PM2 already installed."
fi

############################################
# Configure and Start Backend
############################################
echo "📥 Installing Project Dependencies..."
cd backend_api
npm install >/dev/null 2>&1

echo "🚀 Starting Application..."
if sudo pm2 describe sidorea-api >/dev/null 2>&1; then
    sudo pm2 restart sidorea-api >/dev/null 2>&1
else
    sudo pm2 start server.js --name sidorea-api >/dev/null 2>&1
fi

sudo pm2 save >/dev/null 2>&1

############################################
# Verify Application
############################################
STATUS=$(sudo pm2 jlist | node -e '
const fs=require("fs");
const apps=JSON.parse(fs.readFileSync(0,"utf8"));
const app=apps.find(a=>a.name==="sidorea-api");
console.log(app ? app.pm2_env.status : "stopped");
')

PUBLIC_IP=$(curl -s ifconfig.me)
echo

if [ "$STATUS" != "online" ]; then
    echo "❌ Application failed to start. Try restarting it using: sudo pm2 restart sidorea-api"
    echo "Check logs using: sudo pm2 logs sidorea-api"
    exit 1
fi

echo "✅ App Setup Completed Successfully!"
echo "Application Status : ONLINE"
echo "Application URL    : http://$PUBLIC_IP"
echo
echo "If you want to start, stop or restart application, you can run following commands:"
echo "sudo pm2 start sidorea-api"
echo "sudo pm2 stop sidorea-api"
echo "sudo pm2 restart sidorea-api"
echo
