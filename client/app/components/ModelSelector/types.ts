// Types Reference for ModelSelector Component
// Import these types in your component when using ModelSelector

/**
 * Filter type for model selection
 * - "all": Show all models
 * - "proposer": Only SAM3 and OWLv2 (object detection proposers)
 * - "embedder": Only OWLv2, DINOv3, BioCLIP (embedders)
 */
export type ModelFilterType = "proposer" | "embedder" | "all";

/**
 * Props for ModelSelector component
 * 
 * @example
 * ```tsx
 * const props: ModelSelectorProps = {
 *   selectedModelIds: ["sam3"],
 *   onModelSelect: (id) => setSelected([id]),
 *   onModelDeselect: (id) => setSelected([]),
 *   filterType: "proposer",
 *   tapisToken: "your-token"
 * };
 * ```
 */
export interface ModelSelectorProps {
  // Required
  selectedModelIds: string[];
  onModelSelect: (modelId: string) => void;
  onModelDeselect: (modelId: string) => void;

  // Optional - UI
  title?: string;
  maxHeight?: number;

  // Optional - Behavior
  multiSelect?: boolean;
  filterType?: ModelFilterType;
  tapisToken?: string;

  // Optional - Callbacks
  onDetailsClick?: (modelId: string, source: "ours" | "patra") => void;
  onHfTokenRequired?: (modelId: string, modelName: string) => void;

  // Optional - Data
  patraDetails?: Map<string, PatraModelDetails>;
}

/**
 * Model source type
 */
export type ModelSource = "ours" | "patra";

/**
 * Structure of a model card for display
 */
export interface PatraCard {
  mc_id: string;
  name: string;
  version: string;
  short_description: string;
}

/**
 * Detailed model information
 */
export interface PatraModelDetails {
  id?: string;
  name: string;
  version: string;
  short_description: string;
  is_gated?: boolean;
  ai_model?: {
    name?: string;
    model_id?: string;
    location?: string;
    license?: string;
  };
}

/**
 * Quick reference for common usage patterns
 */

// Pattern 1: Single select proposer model
export interface SingleSelectProposerProps {
  selectedProposerId: string;
  onProposerSelect: (id: string) => void;
  tapisToken: string;
}

// Pattern 2: Dual select (proposer + embedder)
export interface DualSelectModelProps {
  selectedProposerId: string;
  selectedEmbedderId: string;
  onProposerSelect: (id: string) => void;
  onEmbedderSelect: (id: string) => void;
  tapisToken: string;
}

// Pattern 3: Multi-select with details modal
export interface MultiSelectWithDetailsProps {
  selectedModelIds: string[];
  onModelSelect: (id: string) => void;
  onModelDeselect: (id: string) => void;
  onShowDetails: (id: string, source: ModelSource) => void;
  patraDetailsMap: Map<string, PatraModelDetails>;
  tapisToken: string;
}

/**
 * Error types returned by HF Token operations
 */
export interface HfTokenError {
  success: false;
  error: string;
}

export interface HfTokenSuccess {
  success: true;
  error?: undefined;
}

export type HfTokenResult = HfTokenSuccess | HfTokenError;
