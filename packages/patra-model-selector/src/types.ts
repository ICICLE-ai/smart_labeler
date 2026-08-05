export type PatraCard = {
   id: number;
   uuid: string;
   name: string;
   categories: string;
   author: string;
   version: string | null;
   short_description: string;
   is_gated: boolean;
};

export type PatraModelDetails = {
   is_gated?: boolean;
   input_data?: string;
   short_description?: string;
   full_description?: string;
   keywords?: string;
   author?: string;
   input_type?: string;
   name?: string;
   external_id?: string;
   categories?: string;
   output_data?: string;
   version?: string;
   ai_model?: {
      Backbone?: string;
      owner?: string;
      model_type?: string;
      test_accuracy?: number;
      description?: string;
      model_id?: string;
      Learning_Rate?: number;
      version?: string;
      Batch_Size?: number;
      license?: string;
      framework?: string;
      Precision?: number;
      name?: string;
      Recall?: number;
      location?: string;
      inference_labels?: string;
      Input_Shape?: string;
   };
};