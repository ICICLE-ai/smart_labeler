// App-level binding of @icicle-ai/patra-model-selector.
//
// The package takes the Hugging Face guide as a URL prop so it carries no assets
// of its own. This app ships that guide as a bundled PDF, so the adapter resolves
// it and routes keep rendering <ModelSelector /> as before.
import { ModelSelector as PatraModelSelector } from "@icicle-ai/patra-model-selector";
import hfGuideUrl from "~/assets/Hugging_Face_Enhanced.pdf?url";

type PatraModelSelectorProps = React.ComponentProps<typeof PatraModelSelector>;

export const ModelSelector = (props: Omit<PatraModelSelectorProps, "hfGuideUrl">) => (
   <PatraModelSelector {...props} hfGuideUrl={hfGuideUrl} />
);

export default ModelSelector;
