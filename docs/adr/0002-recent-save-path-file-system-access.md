# 2. System-Wide Download Path Memory via Blob Downloads

When extensions use the `chrome.downloads.download` API or the experimental `showSaveFilePicker`, Chrome isolates the download to the extension profile and forces the dialog back to the default `Downloads` folder. Furthermore, `showSaveFilePicker` frequently encounters user gesture expiration when invoked in asynchronous flows.

We decided to trigger downloads by fetching media as a Blob and simulating a standard DOM `<a download="..." href="blob:...">` click directly in the web page (identical to Telegram Web and other high-reliability web downloaders). Because same-origin Blob anchor downloads are handled by Chrome's native browser download subsystem, the OS "Save As" file dialog automatically defaults to the system's most recent download path. Any folder selected by the user updates the system's download path memory, so every subsequent download automatically mounts at that exact location.
