// The observer UI is self-contained. Its CSP blocks network requests with file data.
export default function Home() {
  return <iframe src="/pilot.html" title="SahaIQ Gözlemci Pilotu" sandbox="allow-scripts allow-downloads" style={{width:"100%",height:"100dvh",border:0,display:"block"}} />;
}
