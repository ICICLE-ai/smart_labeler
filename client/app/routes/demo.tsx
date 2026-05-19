import { Link } from "@remix-run/react";

export default function DemoPage() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
      <Link to="/">Go back to home</Link>
    </div>
  );
}
