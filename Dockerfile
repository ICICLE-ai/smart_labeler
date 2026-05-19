FROM rockylinux:8
WORKDIR /harvest
EXPOSE 11111
EXPOSE 3000

ENV PATH="/root/miniconda3/bin:${PATH}"
ARG PATH="/root/miniconda3/bin:${PATH}"

COPY labeler_env.yaml /smart_labeler/requirements.yaml
COPY entrypoint.sh /smart_labeler/entrypoint.sh
COPY server /smart_labeler/server
COPY client /smart_labeler/client
COPY downloadStream.js /smart_labeler/downloadStream.js

RUN chmod +x /smart_labeler/entrypoint.sh


RUN dnf install epel-release -y
RUN dnf config-manager --set-enabled powertools
RUN dnf clean all
RUN dnf update -y
RUN dnf install -y wget python3-devel
RUN dnf install -y --nobest opencv opencv-devel
RUN dnf module install -y nodejs:18/common 
RUN dnf group install -y "Development Tools"

RUN MINICONDA_URL="https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh" && \
    wget $MINICONDA_URL -O /harvest/miniconda.sh && \
    mkdir -p /root/.conda && \
    echo a &&\
    bash miniconda.sh -b -p /root/miniconda3 && \
    rm -f /harvest/miniconda.sh

RUN conda --version
RUN conda tos accept
RUN conda env create --name smart_labeler -f /smart_labeler/requirements.yaml
RUN conda init

RUN chmod -R 777 .
RUN cd /smart_labeler/client && npm install 
#&& npm install --save-exact @babel/runtime@7.0.0-beta.55 && npm install rxjs@7.8.2

#Change file to get around stream saver error
RUN ls  /smart_labeler/client/node_modules/@tapis/tapisui-api/dist/ && mv /smart_labeler/downloadStream.js /smart_labeler/client/node_modules/@tapis/tapisui-api/dist/files/downloadStream.js 

# API_BASE_URL, SAM3_ENDPOINT, TAPIS_BASE_URL are now read from process.env at
# runtime via the Remix root loader — pass them with `docker run -e API_BASE_URL=...`
# instead of baking them in here.
# RUN find /smart_labeler/client -path /smart_labeler/client/node_modules -prune -o -type f -print0 | xargs -0 -r sed -i 's/\["tapis-token"\]?\.\["access_token"\]/\["X-Tapis-Token"\]/g'
RUN find /smart_labeler/client -path /smart_labeler/client/node_modules -prune -o -type f -print0 | xargs -0 -r sed -i 's/\["tapis-token"\]\["access_token"\]/\["X-Tapis-Token"\]/g'
RUN find /smart_labeler/client -path /smart_labeler/client/node_modules -prune -o -type f -print0 | xargs -0 -r sed -i 's/\["tapis-token"\]?\.\["access_token"\]/\["X-Tapis-Token"\]/g'


#Change dev DB to live

RUN cd /smart_labeler/client && npm run build

ENTRYPOINT ["/smart_labeler/entrypoint.sh"]
