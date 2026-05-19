import type { MetaFunction } from "@remix-run/node";
// import { Link, useLoaderData } from "@remix-run/react";
import { Link } from "@remix-run/react";
// import axios from "axios";
import { IndexAppShell } from "~/components/IndexAppShell";

export default function DemoPage() {
  // const [str1, setStr1] = useState("")
  // const str1 = useLoaderData<string>();

  return (
    <IndexAppShell>
      <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
        The ICICLE project is funded by the National Science Foundation (NSF)
        under grant number OAC-2112606.
        <br />
        Contact: Subramoni.1@osu.edu
      </div>
    </IndexAppShell>
  );
}

// export async function loader() {
//   return axios.get('http://localhost:5000/api').then((res) => {
//     console.log(res.data)
//     return res.data.message;
//   }
//   );
// }
