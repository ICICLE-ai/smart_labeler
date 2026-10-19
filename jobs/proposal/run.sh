python generate_proposals.py \
  --proposers sam3 \
  --image_dir /fs/ess/PAS2699/farmers_meet/query \
  --output_dir /fs/ess/PAS2699/farmers_meet/output5 \
  --embedders dinov3 \
  --confidence 0.5 \
  --batch_size 6
  # --is_sahi \
  # --tile_size 1024 \
  # --overlap_ratio 0.2