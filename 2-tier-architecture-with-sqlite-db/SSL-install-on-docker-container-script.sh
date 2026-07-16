#!/bin/bash

distro=$(grep "^ID=" /etc/os-release | cut -d= -f2 | tr -d '"')
if [[ "$distro" != "ubuntu" && "$distro" != "debian" ]]; then
    echo "❌ Unsupported OS. Use Ubuntu or Debian."
    exit 1
fi

sudo apt-get update >/dev/null 2>&1
sudo apt-get install -y nginx curl dnsutils >/dev/null 2>&1

PUBLIC_IP=$(curl -s ifconfig.me)

echo "===================================================="
echo "Nginx Routing & SSL Configuration (2-Tier Docker)"
echo "===================================================="
read -p "Configure HTTPS (SSL) for a custom domain? (1=Yes / 2=No): " SSL_CHOICE

if [ "$SSL_CHOICE" != "1" ]; then
    sudo tee /etc/nginx/sites-available/sidorea-docker > /dev/null << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

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

    echo "✅ Nginx configured. Application accessible at http://$PUBLIC_IP"
    exit 0
fi

while true; do
    read -p "Enter your domain name (e.g., yourdomain.com): " DOMAIN
    if [[ $DOMAIN =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "❌ Error: IP address entered. A domain name is required."
    elif [ -z "$DOMAIN" ]; then
        echo "❌ Error: Domain cannot be empty."
    else
        break
    fi
done

read -p "Enter your email address (for Let's Encrypt): " EMAIL

echo
echo "Create the following DNS A Records pointing to $PUBLIC_IP :"
echo "1) Host: @   | Value: $PUBLIC_IP"
echo "2) Host: www | Value: $PUBLIC_IP"
echo
read -p "Type YES and press ENTER after updating DNS records: " DNS_CONFIRM

echo "Waiting for DNS propagation..."
while true; do
    DOMAIN_IP=$(dig +short "$DOMAIN" | tail -n1)
    if [ "$DOMAIN_IP" = "$PUBLIC_IP" ]; then
        echo "✅ DNS propagated!"
        break
    else
        sleep 30
    fi
done

sudo apt-get install -y certbot python3-certbot-nginx >/dev/null 2>&1

sudo tee /etc/nginx/sites-available/sidorea-docker > /dev/null << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location / {
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

if ! sudo nginx -t >/dev/null 2>&1; then
    echo "❌ Nginx config failed. Aborting."
    exit 1
fi
sudo systemctl restart nginx

# Run certbot silently
sudo certbot --nginx --non-interactive --agree-tos --redirect --email "$EMAIL" -d "$DOMAIN" -d "www.$DOMAIN" >/dev/null 2>&1

echo "🎉 SSL Configuration Complete! Application available at: https://$DOMAIN"
