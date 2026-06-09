FROM rockylinux:8
WORKDIR /smart_labeler

EXPOSE 11112

ENV PATH="/root/miniconda3/bin:${PATH}"
ARG PATH="/root/miniconda3/bin:${PATH}"

# System dependencies required by opencv and Python build tools
RUN dnf install epel-release -y && \
    dnf config-manager --set-enabled powertools && \
    dnf clean all && \
    dnf update -y && \
    dnf install -y wget python3-devel && \
    dnf install -y --nobest opencv opencv-devel && \
    dnf group install -y "Development Tools"

# Install Miniconda
RUN wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/miniconda.sh && \
    mkdir -p /root/.conda && \
    bash /tmp/miniconda.sh -b -p /root/miniconda3 && \
    rm -f /tmp/miniconda.sh

# Create the conda environment from the shared env spec
COPY labeler_env.yaml /smart_labeler/requirements.yaml
RUN conda tos accept && \
    conda env create --name smart_labeler -f /smart_labeler/requirements.yaml && \
    conda init

# Copy server source
COPY server /smart_labeler/server

WORKDIR /smart_labeler/server

CMD ["/bin/bash", "-c", \
    ". /root/miniconda3/bin/activate && conda activate smart_labeler && python3 flask_server.py"]
