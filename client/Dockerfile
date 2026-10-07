FROM node:18

WORKDIR /client

EXPOSE 3000

# NOTE: the build context is the REPOSITORY ROOT, not client/.
#
#   docker build -f client/Dockerfile -t smart-labeler-client .
#
# The Remix build resolves @icicle-ai/* to ../packages/*/src (see the aliases in
# client/vite.config.ts), so the shared package sources have to sit beside the
# client inside the image. With client/ as the context they are outside it, and
# Docker cannot COPY outside its context — the build then fails on
# `Could not load /packages/image-annotator/src/index.ts`.
#
# The packages need no install of their own: vite aliases them to source, and
# their dependencies (react, @mui/*, @mantine/core, formik, react-zoom-pan-pinch,
# @tabler/icons-react) all resolve from /client/node_modules, which resolve.dedupe
# in the vite config pins to a single copy.
COPY client /client
COPY packages /packages

RUN cd /client && npm install

# Patch the vendored downloadStream module before building
RUN mv /client/downloadStream.js /client/node_modules/@tapis/tapisui-api/dist/files/downloadStream.js

# Replace cookie-based tapis token access with the X-Tapis-Token header pattern.
# Only /client needs this: the packages take the token as a prop and never read
# the cookie themselves.
RUN find /client -path /client/node_modules -prune -o -type f -print0 | \
    xargs -0 -r sed -i 's/\["tapis-token"\]\["access_token"\]/\["X-Tapis-Token"\]/g' && \
    find /client -path /client/node_modules -prune -o -type f -print0 | \
    xargs -0 -r sed -i 's/\["tapis-token"\]?\.\["access_token"\]/\["X-Tapis-Token"\]/g'

RUN npm run build

# API_BASE_URL, SAM3_ENDPOINT, ALLOWED_SYSTEMS, etc. are injected at runtime via
# environment variables — pass them with `docker run -e API_BASE_URL=...`
CMD ["npm", "start"]
