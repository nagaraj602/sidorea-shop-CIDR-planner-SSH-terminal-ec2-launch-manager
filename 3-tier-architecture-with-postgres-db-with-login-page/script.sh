#!/bin/bash

# This script is to install everything on your bare metal server and make the app up without using docker or Kubernetes. App backend uses port 3000 but nginx will reverse proxy it and app runs on port 80 (HTTP) or 443 (HTTPS)

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

# Install Required Packages
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
# Prompt for SMTP Credentials securely
echo
echo "===================================================="
echo "📧 Configure Zoho SMTP Credentials for OTP"
echo "===================================================="
read -p "Enter your Zoho Email Address: " ZOHO_EMAIL
read -s -p "Enter your Zoho App Password: " ZOHO_PASS


cat << 'EOF' > .env
PORT=3000
DB_USER=sidorea_user
DB_PASSWORD=supersecurepassword
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sidorea_db

# SMTP Configuration for OTP (Zoho)
SMTP_HOST=smtp.zoho.in
SMTP_PORT=587
SMTP_USER=$ZOHO_EMAIL
SMTP_PASS=$ZOHO_PASS
EOF

echo
📥 Installing the Application...
npm install >/dev/null 2>&1

echo
echo "🚀 Starting Application..."
if sudo pm2 describe sidorea-api >/dev/null 2>&1; then
    sudo pm2 restart sidorea-api >/dev/null 2>&1
else
    sudo pm2 start server.js --name sidorea-api >/dev/null 2>&1
fi

sudo pm2 save >/dev/null 2>&1
cd ..


############################################
# SSL / HTTPS Configuration & Nginx Routing
############################################
PUBLIC_IP=$(curl -s ifconfig.me)

echo
echo "===================================================="
echo "SSL / HTTPS Configuration"
echo "===================================================="
echo "Do you want to configure HTTPS (SSL) for a custom domain?"
echo "1) Yes"
echo "2) No"
read -p "Enter choice (1/2): " SSL_CHOICE

# Fix permissions so Nginx can read the directory regardless of choice
sudo chmod 755 /home/ubuntu

# ---------------------------------------------------------
# STAGE 1: Domain Validation & Escape Hatch
# ---------------------------------------------------------
if [ "$SSL_CHOICE" == "1" ]; then
    
    while true; do
        read -p "Enter your domain name (or type 'cancel' to skip): " DOMAIN

        # Convert input to lowercase to catch "Cancel", "CANCEL", etc.
        if [[ "${DOMAIN,,}" == "cancel" ]]; then
            echo "⚠️  Cancelling SSL setup. Falling back to HTTP / Local IP configuration..."
            SSL_CHOICE="2" # Flip the choice to NO
            break
        elif [[ $DOMAIN =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "❌ Error: You entered an IP address ($DOMAIN). Let's Encrypt requires a fully qualified domain name."
            echo "💡 If you do not have a domain, type 'cancel' to proceed with standard HTTP."
            echo
        elif [ -z "$DOMAIN" ]; then
            echo "❌ Error: Domain cannot be empty. Please try again."
            echo
        else
            break # Valid domain entered, proceed normally
        fi
    done
fi

# ---------------------------------------------------------
# STAGE 2: Execute Nginx Configuration
# ---------------------------------------------------------
# Dynamically resolve the absolute path to the frontend folder
FRONTEND_PATH="$(pwd)/frontend_public"

# Ensure Nginx can read the directory structure up to this path
sudo chmod -R 755 "$(pwd)"

if [ "$SSL_CHOICE" == "1" ]; then

    read -p "Enter your email address (required for Let's Encrypt): " EMAIL

    echo
    echo "===================================================="
    echo "Create the following DNS records with your provider:"
    echo "Domain: $DOMAIN"
    echo 
    echo "A Record | Host: @   | Value: $PUBLIC_IP | TTL: Auto"
    echo "A Record | Host: www | Value: $PUBLIC_IP | TTL: Auto"
    echo "===================================================="
    echo

    read -p "Type YES and press ENTER after you have updated your DNS records: " DNS_CONFIRM

    echo "Waiting for DNS propagation..."
    while true; do
        DOMAIN_IP=$(dig +short "$DOMAIN" | tail -n1)
        if [ "$DOMAIN_IP" = "$PUBLIC_IP" ]; then
            echo "✅ DNS propagated successfully!"
            break
        else
            echo "DNS still not updated (Current IP: ${DOMAIN_IP:-None}). Waiting 30 seconds..."
            sleep 30
        fi
    done

    echo "⚙️ Installing Certbot..."
    sudo apt install certbot python3-certbot-nginx -y >/dev/null 2>&1

    echo "🌐 Configuring Nginx for $DOMAIN..."
    sudo tee /etc/nginx/sites-available/sidorea > /dev/null << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location / {
        root $FRONTEND_PATH;
        index index.html;
        try_files \$uri \$uri.html \$uri/ =404;
    }

    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
EOF

else
    echo "🌐 Configuring Nginx for Local IP..."
    # Removed quotes around EOF to allow injecting the dynamic FRONTEND_PATH
    sudo tee /etc/nginx/sites-available/sidorea > /dev/null << EOF
server {
    listen 80;
    server_name localhost;

    location / {
        root $FRONTEND_PATH;
        index index.html;
        try_files \$uri \$uri.html \$uri/ =404;
    }

    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
EOF
fi

# Enable the site and restart Nginx
sudo ln -sf /etc/nginx/sites-available/sidorea /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

echo "🧪 Testing Nginx configuration..."
if ! sudo nginx -t; then
    echo "❌ Nginx configuration test failed."
    exit 1
fi
sudo systemctl restart nginx

# Run Certbot if SSL was ultimately selected
if [ "$SSL_CHOICE" == "1" ]; then
    echo "🔒 Requesting SSL Certificate from Let's Encrypt..."
    sudo certbot \
        --nginx \
        --non-interactive \
        --agree-tos \
        --redirect \
        --email "$EMAIL" \
        -d "$DOMAIN" \
        -d "www.$DOMAIN" >/dev/null 2>&1
fi

############################################
# Verify Application
############################################
STATUS=$(sudo pm2 jlist | node -e '
const fs=require("fs");
const apps=JSON.parse(fs.readFileSync(0,"utf8"));
const app=apps.find(a=>a.name==="sidorea-api");
console.log(app ? app.pm2_env.status : "stopped");
')

echo
if [ "$STATUS" != "online" ]; then
    echo "❌ Application failed to start. Try restarting it using: sudo pm2 restart sidorea-api"
    echo "Check logs using: sudo pm2 logs sidorea-api"
    exit 1
fi

echo "✅ App Setup Completed Successfully!"
echo "Application Status : ONLINE"

if [ "$SSL_CHOICE" == "1" ]; then
    echo "Application URL    : https://$DOMAIN"
else
    echo "Application URL    : http://$PUBLIC_IP"
fi

echo
echo "Useful Commands"
echo "---------------"
echo "Restart App   : sudo pm2 restart sidorea-api"
echo "App Logs      : sudo pm2 logs sidorea-api"
echo "Restart Nginx : sudo systemctl restart nginx"
echo
