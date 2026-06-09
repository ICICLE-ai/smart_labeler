FROM node:18

WORKDIR /smart_labeler/client

EXPOSE 3000

# Copy package manifests first so npm install is cached as its own layer
COPY client/package.json client/package-lock.json ./

RUN npm install

# Patch the vendored downloadStream module before building
COPY downloadStream.js ./node_modules/@tapis/tapisui-api/dist/files/downloadStream.js

# Copy application source (node_modules is already installed above)
COPY client/app ./app
COPY client/vite.config.ts client/tsconfig.json client/postcss.config.cjs ./

# Replace cookie-based tapis token access with the X-Tapis-Token header pattern
RUN find /smart_labeler/client -path /smart_labeler/client/node_modules -prune -o -type f -print0 | \
    xargs -0 -r sed -i 's/\["tapis-token"\]\["access_token"\]/\["X-Tapis-Token"\]/g' && \
    find /smart_labeler/client -path /smart_labeler/client/node_modules -prune -o -type f -print0 | \
    xargs -0 -r sed -i 's/\["tapis-token"\]?\.\["access_token"\]/\["X-Tapis-Token"\]/g'

RUN npm run build

# API_BASE_URL, SAM3_ENDPOINT, ALLOWED_SYSTEMS, etc. are injected at runtime via
# environment variables — pass them with `docker run -e API_BASE_URL=...`
CMD ["npm", "start"]
