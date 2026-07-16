#!/bin/bash

# Detect Linux Distribution
distro=$(grep "^ID=" /etc/os-release | cut -d= -f2 | tr -d '"')

case "$distro" in
    ubuntu|debian)
        echo "Detected $distro."
        ;;
    *)
        echo "❌ Unsupported Linux Distribution: $distro. This script requires Ubuntu or Debian."
        exit 1
        ;;
esac

echo "🚀 Starting Nginx & SSL Configuration..."
sudo apt-get update >/dev/null 2>&1
sudo apt-get install -y nginx curl dnsutils >/dev/null 2>&1

PUBLIC_IP=$(curl -s ifconfig.me)

echo
echo "===================================================="
echo "Nginx Routing & SSL Configuration (Docker Host)"
echo "===================================================="
echo "Do you want to configure HTTPS (SSL) for a custom domain?"
echo "1) Yes"
echo "2) No (Route via Public IP over HTTP)"
read -p "Enter choice (1/2): " SSL_CHOICE

if [ "$SSL_CHOICE" != "1" ]; then
    echo "🌐 Configuring Nginx for Local IP routing..."
    
    sudo tee /etc/nginx/sites-available/sidorea-docker > /dev/null << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # Route Frontend traffic to the Frontend Docker Container
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Route Backend API traffic to the Backend Docker Container
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Route WebSocket traffic to the Backend Docker Container
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
EOF

    sudo ln -sf /etc/nginx/sites-available/sidorea-docker /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo systemctl restart nginx

    echo "✅ Nginx configured successfully!"
    echo "Your Docker application is accessible at http://$PUBLIC_IP"
    exit 0
fi

# Loop until a valid, non-IP domain is provided
while true; do
    read -p "Enter your domain name (e.g., yourdomain.com): " DOMAIN

    if [[ $DOMAIN =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "❌ Error: You entered an IP address ($DOMAIN). Let's Encrypt requires a fully qualified domain name."
        echo "Please try again."
        echo
    elif [ -z "$DOMAIN" ]; then
        echo "❌ Error: Domain cannot be empty. Please try again."
        echo
    else
        break
    fi
done

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
sudo apt-get install -y certbot python3-certbot-nginx >/dev/null 2>&1

echo "🌐 Generating Nginx configuration for $DOMAIN..."
sudo tee /etc/nginx/sites-available/sidorea-docker > /dev/null << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/sidorea-docker /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

echo "🧪 Testing Nginx configuration..."
if ! sudo nginx -t; then
    echo "❌ Nginx configuration test failed. Aborting SSL setup."
    exit 1
fi
sudo systemctl restart nginx

echo "🔒 Requesting SSL Certificate from Let's Encrypt..."
sudo certbot \
    --nginx \
    --non-interactive \
    --agree-tos \
    --redirect \
    --email "$EMAIL" \
    -d "$DOMAIN" \
    -d "www.$DOMAIN"

echo
echo "🎉 SSL Configuration Complete!"
echo "Your Docker application is now securely routed and available at:"
echo "👉 https://$DOMAIN"
echo
