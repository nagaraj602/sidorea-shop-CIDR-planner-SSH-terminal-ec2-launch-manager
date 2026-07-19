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
echo "🚀 Starting System Package Update..."
sudo apt-get update >/dev/null 2>&1
sudo apt-get upgrade -y >/dev/null 2>&1

# Install Required Packages (Added dnsutils for 'dig' command)
echo "📦 Installing Required Packages..."
sudo apt-get install -y nodejs npm curl wget gnupg software-properties-common ca-certificates apt-transport-https dnsutils >/dev/null 2>&1

############################################
# Install Terraform
############################################
echo "🏗️ Installing Terraform..."
if ! command -v terraform >/dev/null; then
    curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor | sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg >/dev/null 2>&1
    echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list >/dev/null 2>&1
    sudo apt-get update  >/dev/null 2>&1
    sudo apt-get install -y terraform >/dev/null 2>&1
else
    echo "Terraform already installed."
fi

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
# Install Node Modules
############################################
echo "📥 Installing Project Dependencies..."
npm install >/dev/null 2>&1

############################################
# Start Application
############################################
echo "🚀 Starting Application..."

if sudo pm2 describe cidr-app >/dev/null 2>&1; then
    sudo pm2 restart cidr-app >/dev/null 2>&1
else
    sudo pm2 start server.js --name cidr-app >/dev/null 2>&1
fi

############################################
# Save PM2 Process List
############################################
sudo pm2 save >/dev/null 2>&1

############################################
# Verify Application
############################################
STATUS=$(sudo pm2 jlist | node -e '
const fs=require("fs");
const apps=JSON.parse(fs.readFileSync(0,"utf8"));
const app=apps.find(a=>a.name==="cidr-app");
console.log(app ? app.pm2_env.status : "stopped");
')

PUBLIC_IP=$(curl -s ifconfig.me)
echo

if [ "$STATUS" != "online" ]; then
    echo "❌ Application failed to start. Try restarting it using: sudo pm2 restart cidr-app"
    echo "Check logs using: sudo pm2 logs cidr-app"
    exit 1
fi

echo "✅ App Setup Completed Successfully!"
echo "Application Status : ONLINE"

############################################
# SSL / HTTPS Configuration
############################################
echo
echo "===================================================="
echo "SSL / HTTPS Configuration"
echo "===================================================="
echo "Do you want to configure HTTPS (SSL) for a custom domain?"
echo "1) Yes"
echo "2) No"
read -p "Enter choice (1/2): " SSL_CHOICE

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

    # Install Nginx if missing
    if ! command -v nginx >/dev/null; then
        echo "⚙️ Installing Nginx..."
        sudo apt-get install nginx -y >/dev/null 2>&1
    fi

    # Install Certbot if missing
    if ! command -v certbot >/dev/null; then
        echo "⚙️ Installing Certbot..."
        sudo apt-get install certbot python3-certbot-nginx -y >/dev/null 2>&1
    fi

    echo "🌐 Configuring Nginx for $DOMAIN..."
    sudo tee /etc/nginx/sites-available/cidr-app > /dev/null << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

else
    echo "🌐 Configuring Nginx for Local IP routing..."
    
    # Install Nginx if missing
    if ! command -v nginx >/dev/null; then
        echo "⚙️ Installing Nginx..."
        sudo apt-get install nginx -y >/dev/null 2>&1
    fi

    sudo tee /etc/nginx/sites-available/cidr-app > /dev/null << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF
fi

# Enable the site and restart Nginx
sudo ln -sf /etc/nginx/sites-available/cidr-app /etc/nginx/sites-enabled/cidr-app
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

echo
echo "🎉 Application Setup Complete!"
if [ "$SSL_CHOICE" == "1" ]; then
    echo "Your application is securely available at: https://$DOMAIN"
else
    echo "Your application is accessible at: http://$PUBLIC_IP"
fi
echo
echo "Useful Commands"
echo "---------------"
echo "Restart App   : sudo pm2 restart cidr-app"
echo "App Logs      : sudo pm2 logs cidr-app"
echo "Restart Nginx : sudo systemctl restart nginx"
echo
