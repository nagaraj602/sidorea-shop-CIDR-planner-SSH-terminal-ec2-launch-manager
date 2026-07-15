# ==========================================
# STAGE 1: Production Runtime (Frontend)
# ==========================================
FROM nginx:alpine

# Remove the default Nginx index page
RUN rm -rf /usr/share/nginx/html/*

# Copy all the frontend static files into Nginx
COPY . /usr/share/nginx/html

# Overwrite the default Nginx configuration with a dynamic one for K8s
# (Note: In Kubernetes, we route /api/ via the Ingress, so Nginx only needs to serve the static files)
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html; \
        try_files $uri $uri.html $uri/ =404; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
