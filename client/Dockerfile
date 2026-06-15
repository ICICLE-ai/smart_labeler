FROM node:18

WORKDIR /client

EXPOSE 3000

# Copy package manifests first so npm install is cached as its own layer
COPY . /client
COPY downloadStream.js downloadStream.js

RUN cd /client && npm install 

# Patch the vendored downloadStream module before building
RUN mv ./downloadStream.js /client/node_modules/@tapis/tapisui-api/dist/files/downloadStream.js


# Replace cookie-based tapis token access with the X-Tapis-Token header pattern
RUN find /client -path /client/node_modules -prune -o -type f -print0 | \
    xargs -0 -r sed -i 's/\["tapis-token"\]\["access_token"\]/\["X-Tapis-Token"\]/g' && \
    find /client -path /client/node_modules -prune -o -type f -print0 | \
    xargs -0 -r sed -i 's/\["tapis-token"\]?\.\["access_token"\]/\["X-Tapis-Token"\]/g'

RUN npm run build

# API_BASE_URL, SAM3_ENDPOINT, ALLOWED_SYSTEMS, etc. are injected at runtime via
# environment variables — pass them with `docker run -e API_BASE_URL=...`
CMD ["npm", "start"]
