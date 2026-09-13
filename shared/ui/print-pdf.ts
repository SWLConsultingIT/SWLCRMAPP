// Open a chrome-less /print route in a hidden iframe and fire the browser's
// print / Save-as-PDF dialog on it — the user never leaves the page they're on.
// The browser uses the iframe document's title as the default filename, so we
// set it to `name` → "<name>.pdf". Shared by the ICP + template download buttons.
export function printPdf(path: string, name: string) {
  const ID = "growthai-print-frame";
  const prev = document.getElementById(ID);
  if (prev) prev.remove();
  const iframe = document.createElement("iframe");
  iframe.id = ID;
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  iframe.src = path;
  iframe.onload = () => {
    // Small delay so fonts/styles settle before the print snapshot.
    setTimeout(() => {
      try {
        if (iframe.contentDocument && name) iframe.contentDocument.title = name;
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch { /* popup/sandbox edge — ignore */ }
    }, 350);
  };
  document.body.appendChild(iframe);
}
