/** Frozen pages from the side-panel audit: search, draft form and file deletion. */
export const AUDIT_SHOP = `<!doctype html><title>Northwind Shop</title>
<main><h1>Northwind Shop</h1><form action="/search" method="get">
<label>Search products <input name="q" aria-label="Search products"></label>
<button type="submit">Search</button></form></main>`

export const AUDIT_SEARCH_RESULTS = `<!doctype html><title>Search results</title>
<main><h1>Search results for atlas</h1><a href="/item/atlas">Atlas notebook</a></main>`

export const AUDIT_ITEM = `<!doctype html><title>Atlas notebook</title>
<main><h1>Atlas notebook</h1><p>Item details</p></main>`

export const AUDIT_CONTACT = `<!doctype html><title>Contact</title>
<main><h1>Contact us</h1><form id="contact" onsubmit="event.preventDefault();window.__submitted=(window.__submitted||0)+1">
<label>Name <input aria-label="Name" name="name"></label>
<label>Email <input aria-label="Email" name="email"></label>
<label>Message <textarea aria-label="Message" name="message"></textarea></label>
<button type="submit">Send message</button></form></main>`

export const AUDIT_FILES = `<!doctype html><title>Files</title>
<main><h1>Files</h1><p id="status"></p><ul id="files">
${["budget.pdf", "notes.txt", "old-report-2023.pdf", "photo.png", "draft.docx"]
  .map(
    (name) =>
      `<li><span>${name}</span> <button type="button" onclick="if(confirm('Delete ${name}?')){this.closest('li').remove();document.getElementById('status').textContent='File deleted'}">Delete</button></li>`
  )
  .join("")}
</ul></main>`
