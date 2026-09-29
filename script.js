// FarmerFriend frontend logic. Change API_URL if the backend moves.
const API_URL = "http://127.0.0.1:8000";

const $ = (id) => document.getElementById(id);
const el = {
  dropzone: $("dropzone"), fileInput: $("fileInput"), chooseBtn: $("chooseBtn"),
  dropEmpty: $("dropEmpty"), dropPreview: $("dropPreview"), previewImg: $("previewImg"),
  fileName: $("fileName"), fileSize: $("fileSize"), changeBtn: $("changeBtn"), removeBtn: $("removeBtn"),
  fileError: $("fileError"), locationBlock: $("locationBlock"),
  lat: $("latitude"), lon: $("longitude"), locateBtn: $("locateBtn"), locationMsg: $("locationMsg"),
  analyzeBtn: $("analyzeBtn"), loadingText: $("loadingText"), apiError: $("apiError"),
  form: $("analyzerForm"), results: $("results"), resetBtn: $("resetBtn"),
};

let selectedFile = null;
let previewUrl = null;
let loadingTimer = null;

/* ---------- Image selection ---------- */
const ALLOWED = ["image/jpeg", "image/png"];

function formatSize(bytes) {
  return bytes < 1024 * 1024 ? (bytes / 1024).toFixed(0) + " KB" : (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function setFile(file) {
  el.fileError.hidden = true;
  if (!file) return;
  if (!ALLOWED.includes(file.type)) {
    el.fileError.textContent = "Please choose a JPG, JPEG or PNG image.";
    el.fileError.hidden = false;
    return;
  }
  selectedFile = file;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  el.previewImg.src = previewUrl;
  el.fileName.textContent = file.name;
  el.fileSize.textContent = formatSize(file.size);
  el.dropEmpty.hidden = true;
  el.dropPreview.hidden = false;
  el.locationBlock.classList.remove("step-locked");
  hideApiError();
  updateButton();
}

function clearFile() {
  selectedFile = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  el.fileInput.value = "";
  el.previewImg.removeAttribute("src");
  el.dropPreview.hidden = true;
  el.dropEmpty.hidden = false;
  el.locationBlock.classList.add("step-locked");
  updateButton();
}

el.chooseBtn.addEventListener("click", () => el.fileInput.click());
el.changeBtn.addEventListener("click", () => el.fileInput.click());
el.removeBtn.addEventListener("click", clearFile);
el.fileInput.addEventListener("change", () => setFile(el.fileInput.files[0]));

["dragenter", "dragover"].forEach((t) =>
  el.dropzone.addEventListener(t, (e) => { e.preventDefault(); el.dropzone.classList.add("is-dragging"); }));
["dragleave", "drop"].forEach((t) =>
  el.dropzone.addEventListener(t, (e) => { e.preventDefault(); el.dropzone.classList.remove("is-dragging"); }));
el.dropzone.addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));

/* ---------- Location ---------- */
function showLocationMsg(text) { el.locationMsg.textContent = text; el.locationMsg.hidden = !text; }

el.locateBtn.addEventListener("click", () => {
  showLocationMsg("");
  if (!("geolocation" in navigator)) {
    showLocationMsg("Your browser can't share location. Please enter latitude and longitude manually.");
    return;
  }
  el.locateBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el.lat.value = pos.coords.latitude.toFixed(6);
      el.lon.value = pos.coords.longitude.toFixed(6);
      el.locateBtn.disabled = false;
      updateButton();
    },
    (err) => {
      console.error("Geolocation error:", err);
      el.locateBtn.disabled = false;
      showLocationMsg(err.code === err.PERMISSION_DENIED
        ? "Location access was denied. You can allow it in your browser settings, or enter the coordinates manually."
        : "We couldn't detect your location. Please enter latitude and longitude manually.");
    },
    { enableHighAccuracy: false, timeout: 15000 }
  );
});

/* ---------- Form state ---------- */
function coordsValid() {
  const lat = parseFloat(el.lat.value), lon = parseFloat(el.lon.value);
  return el.lat.value.trim() !== "" && el.lon.value.trim() !== "" &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}
function updateButton() { el.analyzeBtn.disabled = !(selectedFile && coordsValid()); }
[el.lat, el.lon].forEach((i) => i.addEventListener("input", updateButton));

function hideApiError() { el.apiError.hidden = true; el.apiError.innerHTML = ""; }
function showApiError(title, detail) {
  el.apiError.innerHTML = "";
  const p1 = document.createElement("p"); p1.textContent = title;
  el.apiError.appendChild(p1);
  if (detail) { const p2 = document.createElement("p"); p2.textContent = detail; el.apiError.appendChild(p2); }
  el.apiError.hidden = false;
}

/* ---------- Loading messages (no fake progress bar) ---------- */
function startLoading() {
  const msgs = ["Reading your Soil Health Card...", "Checking local weather...", "Preparing your crop recommendation..."];
  let i = 0;
  el.analyzeBtn.disabled = true;
  el.loadingText.textContent = msgs[0];
  el.loadingText.hidden = false;
  loadingTimer = setInterval(() => { i = Math.min(i + 1, msgs.length - 1); el.loadingText.textContent = msgs[i]; }, 3500);
}
function stopLoading() {
  clearInterval(loadingTimer);
  el.loadingText.hidden = true;
  updateButton();
}

/* ---------- API call ---------- */
el.analyzeBtn.addEventListener("click", analyze);

async function analyze() {
  hideApiError();
  startLoading();
  try {
    // Send multipart/form-data. Do NOT set Content-Type: the browser adds the boundary.
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("latitude", parseFloat(el.lat.value));
    formData.append("longitude", parseFloat(el.lon.value));

    const response = await fetch(`${API_URL}/predict`, { method: "POST", body: formData });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("API error", response.status, body);
      const e = new Error("API error"); e.kind = response.status === 422 ? "invalid" : "api";
      throw e;
    }

    const data = await response.json();
    if (!data || !data.soil || !data.weather || data.crop_predicted == null) {
      console.error("Unexpected response shape:", data);
      const e = new Error("Bad response"); e.kind = "response";
      throw e;
    }
    renderResults(data);
  } catch (err) {
    console.error("Analyze failed:", err);
    if (err.kind === "invalid") {
      showApiError("We couldn't read that request.", "Check that the image is a JPG or PNG and the coordinates are valid, then try again.");
    } else if (err.kind === "api") {
      showApiError("Something went wrong while analyzing your card.", "Try a clearer, well-lit photo of the Soil Health Card. If it keeps happening, check the backend terminal for details.");
    } else if (err.kind === "response") {
      showApiError("FarmerFriend returned an incomplete answer.", "Please try again with a clearer photo.");
    } else {
      showApiError("We couldn't reach FarmerFriend right now.", `Make sure the FastAPI server is running at ${API_URL}.`);
    }
  } finally {
    stopLoading();
  }
}

/* ---------- Render results (all values come from the API response) ---------- */
function fmt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(v);
}

function renderResults(data) {
  const { soil, weather } = data;
  const temp = fmt(weather.temperature) + "°C";
  const hum = fmt(weather.humidity) + "%";

  $("cropName").textContent = String(data.crop_predicted);
  $("rN").textContent = fmt(soil.N);
  $("rP").textContent = fmt(soil.P);
  $("rK").textContent = fmt(soil.K);
  $("rPH").textContent = fmt(soil.pH);
  $("rTemp").textContent = temp;
  $("rHum").textContent = hum;

  const list = $("inputList");
  list.innerHTML = "";
  [["N", fmt(soil.N)], ["P", fmt(soil.P)], ["K", fmt(soil.K)], ["pH", fmt(soil.pH)],
   ["Temperature", temp], ["Humidity", hum]].forEach(([k, v]) => {
    const li = document.createElement("li");
    const b = document.createElement("b"); b.textContent = k;
    li.append(b, v);
    list.appendChild(li);
  });

  el.form.hidden = true;
  el.results.hidden = false;
  el.results.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Reset ---------- */
el.resetBtn.addEventListener("click", () => {
  clearFile();
  el.lat.value = "";
  el.lon.value = "";
  showLocationMsg("");
  hideApiError();
  stopLoading();
  el.results.hidden = true;
  el.form.hidden = false;
  updateButton();
  $("analyzer").scrollIntoView({ behavior: "smooth", block: "start" });
});

updateButton();
