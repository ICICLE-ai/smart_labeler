#!/bin/bash
. /root/miniconda3/bin/activate
conda activate smart_labeler

cd /smart_labeler/client
npm start &

cd /smart_labeler/server
python3 flask_server.py