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
        root /home/ubuntu/sidorea-shop-CIDR-planner-SSH-terminal-ec2-launch-manager/3-tier-architecture-with-postgres-db/frontend_public;
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
        -d "www.$DOMAIN"
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
