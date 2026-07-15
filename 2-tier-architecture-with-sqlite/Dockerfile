# ==========================================
# STAGE 1: Dependency Builder
# ==========================================
FROM node:18-bullseye-slim AS builder
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# ==========================================
# STAGE 2: Final Runtime Image
# ==========================================
FROM node:18-bullseye-slim
WORKDIR /app

# Install Terraform and required system tools
RUN apt-get update && apt-get install -y \
    wget unzip gnupg software-properties-common curl \
    && wget -O- https://apt.releases.hashicorp.com/gpg | gpg --dearmor | tee /usr/share/keyrings/hashicorp-archive-keyring.gpg >/dev/null \
    && echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | tee /etc/apt/sources.list.d/hashicorp.list \
    && apt-get update && apt-get install -y terraform \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy Node modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source code
COPY . .

# Expose the port your app runs on
EXPOSE 80

# Start the application
CMD ["node", "server.js"]
