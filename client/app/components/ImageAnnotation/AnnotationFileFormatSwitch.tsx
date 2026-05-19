import { FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';



interface AnnotationFileFormatSwitchProps {
    coco: boolean;
    onChange: (coco: boolean) => void;
}

const AnnotationFileFormatSwitch: React.FC<AnnotationFileFormatSwitchProps> = ({
    coco,
    onChange,
}) => {

    const [cocoState, setCocoState] = useState<boolean>(coco);

    useEffect(() => {
        onChange(cocoState);
    }, [cocoState]);

    return (
        <>
            <FormControlLabel
                                 control={
                                    <Switch
                                       checked={cocoState}
                                       onChange={(e) =>
                                          setCocoState(e.target.checked)
                                       }
                                       color="primary"
                                    />
                                 }
                                 label={cocoState ? "COCO JSON" : "Default JSON"}
                              />
                              <Typography
                                 variant="subtitle2"
                                 sx={{ mt: 2, mb: 1 }}
                              >
                                 Format Preview
                              </Typography>
                              <TextField
                                 multiline
                                 fullWidth
                                 minRows={cocoState ? 8 : 3}
                                 value={
                                    cocoState
                                       ? `{
           "info": {
            "year": 2024,
            "version": "1.0",
            "date_created": "2024-06-01"
           },
           "licenses": [],
           "images": [
            {
              "id": 1,
              "width": 640,
              "height" : 480,
              "file_name": "image1.jpg"
            }, ...
           ],
           "categories": [
               {
                 "id": 1,
                 "name": "animals",
                 "supercategory": "none"
               },...
           ],
           "annotations": [
            {
             "id": 1,
             "image_id": 1,
             "category_id": 1,
             "bbox": [x1, y1, width, height],
             "area": area,
             "iscrowd": 0
           }, ...
           ]
         }`
                                       : `{
           "image_path": "/path/to/image.jpg",
           "class": "donkey",
           "bounding_box": [x1, y1, x2, y2]
         }`
                                 }
                                 InputProps={{
                                    readOnly: true,
                                 }}
                                 sx={{
                                    fontFamily: "monospace",
                                    background: "#f5f5f5",
                                    mb: 2,
                                 }}
                              />
        </>
    );
};

export default AnnotationFileFormatSwitch;