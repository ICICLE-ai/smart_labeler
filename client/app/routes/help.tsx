import { IndexAppShell } from "~/components/IndexAppShell";
import { useAppConfig } from "~/context/AppConfigContext";



export default function HelpPage() {
  const config = useAppConfig();
  
  // Select doc URL based on annotator type
  const annotator_type = config.annotatorType ?? "DETECTION"
  const DETECTION_DOC_URL = "https://buckeyemailosu-my.sharepoint.com/:w:/g/personal/jajodia_6_buckeyemail_osu_edu/IQDKR27YD4HXTo2eFkEU5umiAToGmQAUjXW03u7YsBRhjKE?e=uoVbXP"
  const SEGMENTATION_DOC_URL = "https://buckeyemailosu-my.sharepoint.com/:w:/g/personal/jajodia_6_buckeyemail_osu_edu/IQBxXEZus4OFQbzZH5qi7anfAVC_CUvmJCTUN97Rqi3_CiI?e=ygWKaO"
    
  return (
    <IndexAppShell>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "calc(100vh - 80px)",
          padding: "16px",
          gap: "8px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>
            Documentation
          </h2>
          <a
            href={annotator_type === "DETECTION" ? DETECTION_DOC_URL : SEGMENTATION_DOC_URL }
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: "0.85rem", color: "#1976d2" }}
          >
            Open in new tab ↗
          </a>
        </div>
        <iframe
          src={(annotator_type === "DETECTION" ? DETECTION_DOC_URL : SEGMENTATION_DOC_URL) + "&action=embedview"}
          title="Smart Labeler Documentation"
          style={{
            flex: 1,
            border: "1px solid #ddd",
            borderRadius: "6px",
            width: "100%",
          }}
          allowFullScreen
        />
      </div>
    </IndexAppShell>
  );
}
