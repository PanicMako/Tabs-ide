const params = new URLSearchParams(location.search);
document.getElementById("project").textContent = params.get("project") ?? "Unknown";
document.getElementById("profile").textContent = params.get("profile") ?? "Unknown";
