window.onload = () => {
  const content = localStorage.getItem("print_html")
  const filename = localStorage.getItem("print_filename")

  if (content) {
    if (filename) document.title = filename
    const container = document.getElementById("print-content")
    if (container) {
      container.innerHTML = content
    }
    localStorage.removeItem("print_html")
    localStorage.removeItem("print_filename")

    // Give a bit of time for layout/images
    setTimeout(() => {
      window.print()
      window.onafterprint = () => window.close()
    }, 800)
  } else {
    window.close()
  }
}
