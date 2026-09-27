const state = {
  user: null,
  accessToken: sessionStorage.getItem("canvas_access_token"),
  csrfToken: sessionStorage.getItem("canvas_csrf_token"),
  dashboard: null,
  currentCourse: null,
  courseTab: "home",
  history: [],
  calendarDate: new Date(),
  calendarItems: [],
  calendarFilter: "all",
  conversations: [],
  selectedConversationId: null,
  inboxBox: "inbox",
};

const loginScreen = document.querySelector("#login-screen");
const appShell = document.querySelector("#app-shell");
const mainContent = document.querySelector("#main-content");
const navigationTray = document.querySelector("#navigation-tray");
const dialog = document.querySelector("#dialog");
const dialogTitle = document.querySelector("#dialog-title");
const dialogBody = document.querySelector("#dialog-body");

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

async function request(path, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  const isFormData = requestOptions.body instanceof FormData;
  const response = await fetch(path, {
    ...requestOptions,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(state.accessToken ? { Authorization: `Bearer ${state.accessToken}` } : {}),
      ...(state.csrfToken ? { "X-CSRF-Token": state.csrfToken } : {}),
      ...headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Canvas could not complete this request.");
  return data;
}

function initials(name) {
  return name.split(" ").filter(Boolean).slice(-2).map((part) => part[0]).join("").toUpperCase();
}

function formatDate(value, withTime = true) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "long", day: "numeric", year: "numeric",
  }).format(new Date(value));
}

function setActiveNav(target) {
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === target);
  });
}

function showLoading() {
  mainContent.innerHTML = '<div class="loading-state"><span class="spinner"></span><p>Loading...</p></div>';
}

function showError(error) {
  mainContent.innerHTML = `<div class="error-state"><h2>Something went wrong</h2><p>${escapeHtml(error.message)}</p><button class="Button" data-retry>Retry</button></div>`;
  document.querySelector("[data-retry]")?.addEventListener("click", loadDashboard);
}

function showFlash(message) {
  const flash = document.querySelector("#flash-message");
  flash.textContent = message;
  flash.classList.remove("hidden");
  window.setTimeout(() => flash.classList.add("hidden"), 2600);
}

function openDialog(title, body) {
  dialogTitle.textContent = title;
  dialogBody.innerHTML = body;
  dialog.classList.remove("hidden");
}

function closeDialog() {
  dialog.classList.add("hidden");
}

function closeTray() {
  navigationTray.classList.add("hidden");
  navigationTray.innerHTML = "";
}

function recordHistory(label, action) {
  state.history = [
    { label, action, at: new Date().toISOString() },
    ...state.history.filter((item) => item.label !== label),
  ].slice(0, 12);
}

async function login(email, password) {
  const error = document.querySelector("#login-error");
  error.textContent = "";
  try {
    const data = await request("/api/session", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    state.user = data.user;
    state.accessToken = data.access_token;
    state.csrfToken = data.csrf_token;
    sessionStorage.setItem("canvas_access_token", data.access_token);
    sessionStorage.setItem("canvas_csrf_token", data.csrf_token);
    localStorage.setItem("canvas_user_id", data.user.id);
    document.querySelector("#nav-avatar").textContent = initials(data.user.name);
    loginScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    await loadDashboard();
  } catch (err) {
    error.textContent = err.message;
  }
}

document.querySelector("#login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  login(document.querySelector("#email").value, document.querySelector("#password").value);
});

document.querySelector("#forgot-password").addEventListener("click", () => {
  openDialog(
    "Forgot Password?",
    '<p>Enter your Email and we\'ll send you a link to change your password.</p><label class="ic-Label" for="forgot-email">Email</label><input id="forgot-email" class="ic-Input" type="email"><div style="text-align:right"><button class="Button Button--primary" data-request-password>Request Password</button></div>',
  );
  document.querySelector("[data-request-password]").addEventListener("click", () => {
    closeDialog();
    showFlash("Password recovery is not configured for this installation.");
  });
});

function dashboardCard(course) {
  return `
    <article class="ic-DashboardCard" style="--course-color:${course.color}" data-course-id="${course.id}">
      <div class="ic-DashboardCard__header">
        <div class="ic-DashboardCard__header_hero"></div>
        <button class="ic-DashboardCard__header-button" aria-label="Course card options">⋮</button>
        <button class="ic-DashboardCard__link" data-open-course="${course.id}">
          <div class="ic-DashboardCard__header_content">
            <h2 class="ic-DashboardCard__header-title">${escapeHtml(course.name)}</h2>
            <div class="ic-DashboardCard__header-subtitle">${escapeHtml(course.code)}</div>
            <div class="ic-DashboardCard__header-term">${escapeHtml(course.term)}</div>
          </div>
        </button>
      </div>
      <nav class="ic-DashboardCard__action-container" aria-label="Actions for ${escapeHtml(course.name)}">
        <button class="ic-DashboardCard__action" title="Announcements" data-card-tab="announcements" data-card-course="${course.id}">♢</button>
        <button class="ic-DashboardCard__action" title="Assignments" data-card-tab="assignments" data-card-course="${course.id}">▤</button>
        <button class="ic-DashboardCard__action" title="Discussions" data-card-tab="discussions" data-card-course="${course.id}">◯</button>
        <button class="ic-DashboardCard__action" title="Files" data-card-tab="files" data-card-course="${course.id}">▱</button>
      </nav>
    </article>`;
}

function bindCourseLinks() {
  document.querySelectorAll("[data-open-course]").forEach((button) => {
    button.addEventListener("click", () => loadCourse(Number(button.dataset.openCourse), "home"));
  });
  document.querySelectorAll("[data-card-tab]").forEach((button) => {
    button.addEventListener("click", () => loadCourse(Number(button.dataset.cardCourse), button.dataset.cardTab));
  });
}

function sidebarItems(items, icon) {
  if (!items.length) return '<p class="muted">Nothing for now</p>';
  return items.map((item) => `
    <div class="sidebar-item">
      <span class="sidebar-icon">${icon}</span>
      <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.course_code)} · ${formatDate(item.due_at)}</small></div>
    </div>`).join("");
}

async function loadDashboard() {
  closeTray();
  showLoading();
  setActiveNav("dashboard");
  try {
    state.dashboard = await request(`/api/dashboard/${state.user.id}`);
    state.currentCourse = null;
    recordHistory("Dashboard", loadDashboard);
    mainContent.innerHTML = `
      <div class="content-header">
        <h1>Dashboard</h1>
        <div class="content-header-actions"><button class="Button" data-global-search>Search</button>${state.user.role === "instructor" ? '<button class="Button Button--primary" data-new-course>+ Course</button>' : ""}</div>
      </div>
      <div class="dashboard-layout">
        <section class="ic-DashboardCard__box">
          <div class="ic-DashboardCard__box__container">
            ${state.dashboard.courses.map(dashboardCard).join("")}
          </div>
        </section>
        <aside class="dashboard-sidebar">
          <section><h2>To Do</h2>${sidebarItems(state.dashboard.todos, "▤")}</section>
          <section><h2>Recent Feedback</h2>${sidebarItems(state.dashboard.recent_feedback, "✓")}</section>
        </aside>
      </div>`;
    bindCourseLinks();
    document.querySelector("[data-new-course]")?.addEventListener("click", openCourseCreator);
    document.querySelector("[data-global-search]")?.addEventListener("click", openGlobalSearch);
  } catch (error) {
    showError(error);
  }
}

function openAccountTray() {
  const user = state.user;
  navigationTray.innerHTML = `
    <div class="tray-header"><h2>Account</h2><button class="close-button" aria-label="Close">×</button></div>
    <div class="tray-profile"><div class="tray-avatar" style="background:${user.avatar_color}">${initials(user.name)}</div><h3>${escapeHtml(user.name)}</h3><p>${escapeHtml(user.email)}</p></div>
    <ul class="tray-list"><li><button>Notifications</button></li><li><button>Profile</button></li><li><button>Files</button></li><li><button>Settings</button></li><li><button data-logout>Logout</button></li></ul>`;
  navigationTray.classList.remove("hidden");
  navigationTray.querySelector(".close-button").addEventListener("click", closeTray);
  navigationTray.querySelector("[data-logout]").addEventListener("click", logout);
}

function openCoursesTray() {
  navigationTray.innerHTML = `
    <div class="tray-header"><h2>Courses</h2><button class="close-button" aria-label="Close">×</button></div>
    <ul class="tray-list">
      ${state.dashboard.courses.map((course) => `<li><button data-tray-course="${course.id}">${escapeHtml(course.name)}</button></li>`).join("")}
      <li><button data-all-courses>All Courses</button></li>
    </ul>`;
  navigationTray.classList.remove("hidden");
  navigationTray.querySelector(".close-button").addEventListener("click", closeTray);
  navigationTray.querySelectorAll("[data-tray-course]").forEach((button) => {
    button.addEventListener("click", () => loadCourse(Number(button.dataset.trayCourse), "home"));
  });
  navigationTray.querySelector("[data-all-courses]").addEventListener("click", renderAllCourses);
}

function openHelpTray() {
  navigationTray.innerHTML = `
    <div class="tray-header"><h2>Help</h2><button class="close-button" aria-label="Close">×</button></div>
    <ul class="tray-list"><li><button>Search the Canvas Guides</button></li><li><button>Report a Problem</button></li><li><button>Ask Your Instructor a Question</button></li><li><button>Submit a Feature Idea</button></li></ul>`;
  navigationTray.classList.remove("hidden");
  navigationTray.querySelector(".close-button").addEventListener("click", closeTray);
}

function openCourseCreator() {
  openDialog("Start a New Course", '<form id="course-creator"><label class="ic-Label" for="new-course-name">Course Name</label><input class="ic-Input" id="new-course-name" required><label class="ic-Label" for="new-course-code">Course Code</label><input class="ic-Input" id="new-course-code" required><label class="ic-Label" for="new-course-term">Term</label><input class="ic-Input" id="new-course-term" value="2026–2027" required><label class="ic-Label" for="new-course-color">Color</label><input class="ic-Input color-input" id="new-course-color" type="color" value="#0374b5"><div class="dialog-actions"><button class="Button" type="button" data-cancel-course>Cancel</button><button class="Button Button--primary">Create Course</button></div></form>');
  document.querySelector("[data-cancel-course]").addEventListener("click", closeDialog);
  document.querySelector("#course-creator").addEventListener("submit", async (event) => { event.preventDefault(); await request("/api/courses", { method: "POST", body: JSON.stringify({ user_id: state.user.id, name: document.querySelector("#new-course-name").value, code: document.querySelector("#new-course-code").value, term: document.querySelector("#new-course-term").value, color: document.querySelector("#new-course-color").value, published: true }) }); closeDialog(); showFlash("Course created"); await loadDashboard(); });
}

function openGlobalSearch() {
  openDialog("Search", '<form id="global-search-form"><label class="ic-Label" for="global-search-query">Search courses and content</label><input class="ic-Input" id="global-search-query" minlength="2" required><div class="dialog-actions"><button class="Button Button--primary">Search</button></div></form><div id="global-search-results"></div>');
  document.querySelector("#global-search-form").addEventListener("submit", async (event) => { event.preventDefault(); const results = await request(`/api/search?q=${encodeURIComponent(document.querySelector("#global-search-query").value)}&user_id=${state.user.id}`); document.querySelector("#global-search-results").innerHTML = results.map((item) => `<button class="content-row search-result" data-search-course="${item.course_id}" data-search-type="${item.type}"><span class="content-row-icon">⌕</span><div><span class="content-row-title">${escapeHtml(item.title)}</span><span class="content-row-meta">${escapeHtml(item.type)}</span></div><span>›</span></button>`).join("") || '<p class="muted">No results found.</p>'; document.querySelectorAll("[data-search-course]").forEach((button) => button.addEventListener("click", () => { closeDialog(); const type = button.dataset.searchType; const tabMap = { assignment: "assignments", announcement: "announcements", discussion: "discussions", page: "pages", outcome: "outcomes", quiz: "quizzes", syllabus: "syllabus" }; loadCourse(Number(button.dataset.searchCourse), tabMap[type] || "home"); })); });
}

function renderAllCourses() {
  closeTray();
  setActiveNav("courses");
  recordHistory("All Courses", renderAllCourses);
  mainContent.innerHTML = `
    <div class="content-header"><h1>All Courses</h1></div>
    <h2 style="font-size:20px;font-weight:400">Courses</h2>
    <table class="canvas-table">
      <thead><tr><th>Favorite</th><th>Course</th><th>Nickname</th><th>Term</th><th>Enrolled as</th></tr></thead>
      <tbody>${state.dashboard.courses.map((course) => `<tr><td><span class="star">★</span></td><td><a href="#" data-open-course="${course.id}">${escapeHtml(course.name)}</a></td><td></td><td>${escapeHtml(course.term)}</td><td>${course.enrollment_role === "student" ? "Student" : "Teacher"}</td></tr>`).join("")}</tbody>
    </table>`;
  bindCourseLinks();
}

const courseTabs = [
  ["home", "Home"], ["announcements", "Announcements"], ["assignments", "Assignments"],
  ["discussions", "Discussions"], ["grades", "Grades"], ["people", "People"],
  ["pages", "Pages"], ["files", "Files"], ["syllabus", "Syllabus"],
  ["outcomes", "Outcomes"], ["quizzes", "Quizzes"], ["modules", "Modules"],
  ["pacewise", "PaceWise"],
];

async function loadCourse(courseId, tab = "home") {
  closeTray();
  showLoading();
  setActiveNav("courses");
  try {
    state.currentCourse = await request(`/api/courses/${courseId}?user_id=${state.user.id}`);
    state.courseTab = tab;
    recordHistory(`${state.currentCourse.course.code}: ${tabName(tab)}`, () => loadCourse(courseId, tab));
    renderCourseShell();
  } catch (error) {
    showError(error);
  }
}

function tabName(tab) {
  return courseTabs.find(([key]) => key === tab)?.[1] || "Home";
}

function renderCourseShell() {
  const { course } = state.currentCourse;
  const tabs = [...courseTabs];
  if (state.user.role === "instructor") tabs.push(["settings", "Settings"]);
  mainContent.innerHTML = `
    <div class="breadcrumbs"><a href="#" data-dashboard-link>Dashboard</a> &gt; ${escapeHtml(course.code)} &gt; ${tabName(state.courseTab)}</div>
    <div class="course-shell">
      <nav class="course-nav" aria-label="Course Navigation"><ul>${tabs.map(([key, label]) => `<li><button class="${state.courseTab === key ? "active" : ""}" data-course-tab="${key}">${label}</button></li>`).join("")}</ul></nav>
      <section class="course-main" id="course-main"></section>
    </div>`;
  document.querySelector("[data-dashboard-link]").addEventListener("click", (event) => { event.preventDefault(); loadDashboard(); });
  document.querySelectorAll("[data-course-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.courseTab = button.dataset.courseTab;
      recordHistory(`${course.code}: ${tabName(state.courseTab)}`, () => loadCourse(course.id, state.courseTab));
      renderCourseShell();
    });
  });
  renderCourseTab();
}

function courseHeader(title, actions = "") {
  return `<div class="content-header"><h1>${escapeHtml(title)}</h1><div class="content-header-actions">${actions}</div></div>`;
}

function assignmentRows(assignments, allowSubmit = false) {
  if (!assignments.length) return '<div class="empty-state"><p>No assignments found.</p></div>';
  return assignments.map((item) => `
    <div class="content-row">
      <span class="content-row-icon">▤</span>
      <div><span class="content-row-title">${escapeHtml(item.title)}</span><span class="content-row-meta">Due ${formatDate(item.due_at)} · ${item.points_possible} pts</span></div>
      <div class="row-actions">${state.user.role === "instructor" ? `<button class="Button Button--small" data-assignment-edit="${item.id}">Edit</button><button class="Button Button--small" data-assignment-delete="${item.id}">Delete</button>` : allowSubmit ? `<button class="Button" data-submit="${item.id}">${["submitted", "late"].includes(item.state) ? "Resubmit Assignment" : "Submit Assignment"}</button>` : `<span class="published-icon">✓</span>`}</div>
    </div>`).join("");
}

function renderCourseTab() {
  const root = document.querySelector("#course-main");
  const data = state.currentCourse;
  const { course, assignments, resources, people, gradebook } = data;
  const tab = state.courseTab;

  if (tab === "home") {
    root.innerHTML = `${courseHeader(course.name)}<div class="course-home-grid"><div class="course-home"><h2>${escapeHtml(course.name)}</h2><p>Welcome to ${escapeHtml(course.name)}.</p><div class="item-group"><div class="item-group-header"><h3>Coming Up</h3></div>${assignmentRows(assignments.slice(0, 3))}</div></div><aside class="course-options">${state.user.role === "instructor" ? '<button class="Button">Course Status: Published</button><button class="Button">Import Existing Content</button><button class="Button">Choose Home Page</button><button class="Button">View Course Stream</button>' : '<button class="Button">View Course Calendar</button><button class="Button">View Course Notifications</button>'}<h3>To Do</h3>${assignments.slice(0, 3).map((item) => `<a href="#" data-tab-assignment>${escapeHtml(item.title)}</a><small class="content-row-meta">${formatDate(item.due_at)}</small>`).join("")}</aside></div>`;
  } else if (tab === "assignments") {
    root.innerHTML = `${courseHeader("Assignments", state.user.role === "instructor" ? '<button class="Button Button--primary" data-new-assignment>+ Assignment</button>' : "")}<div class="item-group"><div class="item-group-header"><h2>Assignments</h2><span>⋮</span></div>${assignmentRows(assignments, state.user.role === "student")}</div>`;
    bindSubmitButtons();
    bindAssignmentActions();
  } else if (tab === "modules") {
    renderModulesTab(root);
  } else if (tab === "grades") {
    root.innerHTML = renderGrades(course, assignments, gradebook);
    bindGradebookActions();
  } else if (tab === "people") {
    root.innerHTML = `${courseHeader("People", state.user.role === "instructor" ? '<button class="Button Button--primary" data-add-person>+ People</button>' : "")}<table class="canvas-table"><thead><tr><th>Name</th><th>Login ID</th><th>Role</th><th>Last Activity</th><th></th></tr></thead><tbody>${people.map((person) => `<tr><td><div class="person"><span class="person-avatar">${initials(person.name)}</span><a href="#">${escapeHtml(person.name)}</a></div></td><td>${escapeHtml(person.email)}</td><td>${person.role === "student" ? "Student" : "Teacher"}</td><td>—</td><td>${state.user.role === "instructor" && person.id !== state.user.id ? `<button class="Button Button--small" data-remove-person="${person.id}">Remove</button>` : ""}</td></tr>`).join("")}</tbody></table>`;
    bindPeopleActions();
  } else if (tab === "files") {
    root.innerHTML = `${courseHeader("Files", state.user.role === "instructor" ? '<button class="Button Button--primary" data-upload-file>Upload</button><button class="Button" data-add-link>+ Link</button>' : "")}<div class="item-group">${resources.map((item) => `<div class="content-row"><span class="content-row-icon">▱</span><div><a class="content-row-title" href="${escapeHtml(item.source_url)}${item.source_url.startsWith("/api/files/") ? `?user_id=${state.user.id}` : ""}" target="_blank">${escapeHtml(item.title)}</a><span class="content-row-meta">${escapeHtml(item.kind)}</span></div>${state.user.role === "instructor" ? `<button class="Button Button--small" data-delete-resource="${item.id}">Delete</button>` : '<span class="published-icon">✓</span>'}</div>`).join("") || '<div class="empty-state"><p>No files.</p></div>'}</div>`;
    bindFileActions();
  } else if (tab === "syllabus") {
    root.innerHTML = renderCourseContentPage("syllabus") + `<div class="item-group"><div class="item-group-header"><h3>Course Summary</h3></div>${assignmentRows(assignments)}</div>`;
    bindCourseContentActions("syllabus");
  } else if (tab === "settings") {
    renderCourseSettings(root);
  } else if (tab === "pacewise") {
    renderPacewiseTab(root);
  } else {
    root.innerHTML = renderCourseContentPage(tab);
    bindCourseContentActions(tab);
  }
}

function renderPacewiseTab(root) {
  const course = state.currentCourse.course;
  root.innerHTML = `${courseHeader("PaceWise")}<div class="empty-state"><h2>Open PaceWise</h2><p>Continue with your current course and ${escapeHtml(state.user.role)} role.</p><button class="Button Button--primary" data-launch-pacewise>Open PaceWise</button></div>`;
  document.querySelector("[data-launch-pacewise]").addEventListener("click", async () => {
    const button = document.querySelector("[data-launch-pacewise]");
    button.disabled = true;
    button.textContent = "Preparing secure launch...";
    try {
      const launch = await request(`/api/pacewise/launch/${course.id}`, { method: "POST" });
      window.location.assign(launch.launch_url);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Open PaceWise";
      showFlash(error.message);
    }
  });
}

function renderGrades(course, assignments, gradebook) {
  if (state.user.role === "student") {
    const own = gradebook.find((row) => row.user_id === state.user.id);
    return `${courseHeader("Grades for " + course.name)}<table class="canvas-table"><thead><tr><th>Name</th><th>Due</th><th>Status</th><th>Score</th><th>Out of</th></tr></thead><tbody>${assignments.map((assignment) => { const grade = own?.grades.find((item) => item.assignment_id === assignment.id); return `<tr><td><a href="#">${escapeHtml(assignment.title)}</a></td><td>${formatDate(assignment.due_at)}</td><td>${escapeHtml(assignment.state)}</td><td>${grade?.score ?? "—"}</td><td>${assignment.points_possible}</td></tr>`; }).join("")}</tbody></table>`;
  }
  return `${courseHeader("Gradebook", '<button class="Button" data-export-grades>Export CSV</button>')}<div style="overflow:auto"><table class="canvas-table"><thead><tr><th>Student Name</th>${assignments.map((assignment) => `<th><button class="grade-heading" data-speedgrader="${assignment.id}">${escapeHtml(assignment.title)}</button><span class="content-row-meta">Out of ${assignment.points_possible}</span></th>`).join("")}</tr></thead><tbody>${gradebook.map((row) => `<tr><td><a href="#">${escapeHtml(row.name)}</a></td>${row.grades.map((grade) => `<td><button class="grade-cell" data-grade-assignment="${grade.assignment_id}" data-grade-student="${row.user_id}">${grade.score ?? "—"}</button></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

const contentKinds = {
  announcements: { kind: "announcement", title: "Announcements", singular: "Announcement", icon: "♢" },
  discussions: { kind: "discussion", title: "Discussions", singular: "Discussion", icon: "◯" },
  pages: { kind: "page", title: "Pages", singular: "Page", icon: "▧" },
  outcomes: { kind: "outcome", title: "Outcomes", singular: "Outcome", icon: "◎" },
  quizzes: { kind: "quiz", title: "Quizzes", singular: "Quiz", icon: "✓" },
  syllabus: { kind: "syllabus", title: "Syllabus", singular: "Syllabus", icon: "▤" },
};

function renderCourseContentPage(tab) {
  const config = contentKinds[tab];
  if (!config) return `${courseHeader(tabName(tab))}<div class="empty-state"><p>No content is available.</p></div>`;
  const items = state.currentCourse.content[config.kind] || [];
  const createButton = state.user.role === "instructor"
    ? `<button class="Button Button--primary" data-content-create>+ ${config.singular}</button>`
    : "";
  const rows = items.map((item) => `
    <div class="content-row content-row-expanded">
      <span class="content-row-icon">${config.icon}</span>
      <button class="content-title-button" data-content-view="${item.id}">
        <span class="content-row-title">${escapeHtml(item.title)}</span>
        <span class="content-row-meta">${item.due_at ? `Due ${formatDate(item.due_at)} · ` : ""}${item.points_possible != null ? `${item.points_possible} pts · ` : ""}${formatDate(item.created_at)}</span>
      </button>
      <div class="row-actions">
        <span class="published-icon" title="Published">${item.published ? "✓" : "○"}</span>
        ${state.user.role === "instructor" ? `<button class="Button Button--small" data-content-edit="${item.id}">Edit</button><button class="Button Button--small" data-content-delete="${item.id}">Delete</button>` : ""}
      </div>
    </div>`).join("");
  return `${courseHeader(config.title, createButton)}<div class="item-group"><div class="item-group-header"><h2>${config.title}</h2></div>${rows || `<div class="empty-state"><p>No ${config.title.toLowerCase()} are available.</p></div>`}</div>`;
}

function bindCourseContentActions(tab) {
  const config = contentKinds[tab];
  if (!config) return;
  const items = state.currentCourse.content[config.kind] || [];
  document.querySelector("[data-content-create]")?.addEventListener("click", () => openContentEditor(tab));
  document.querySelectorAll("[data-content-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = items.find((entry) => entry.id === Number(button.dataset.contentView));
      if (tab === "discussions") return openDiscussion(item);
      if (tab === "quizzes") return openQuiz(item);
      if (tab === "outcomes") return openOutcome(item);
      openDialog(item.title, `<div class="canvas-content-body">${escapeHtml(item.body).replaceAll("\n", "<br>")}</div>${item.due_at ? `<p class="muted">Due ${formatDate(item.due_at)}</p>` : ""}`);
    });
  });
  document.querySelectorAll("[data-content-edit]").forEach((button) => {
    button.addEventListener("click", () => openContentEditor(tab, items.find((entry) => entry.id === Number(button.dataset.contentEdit))));
  });
  document.querySelectorAll("[data-content-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = items.find((entry) => entry.id === Number(button.dataset.contentDelete));
      if (!window.confirm(`Delete "${item.title}"?`)) return;
      await request(`/api/courses/${state.currentCourse.course.id}/content/${config.kind}/${item.id}?user_id=${state.user.id}`, { method: "DELETE" });
      showFlash(`${config.singular} deleted`);
      await loadCourse(state.currentCourse.course.id, tab);
    });
  });
}

function inputDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function openContentEditor(tab, item = null) {
  const config = contentKinds[tab];
  openDialog(`${item ? "Edit" : "New"} ${config.singular}`, `
    <form id="content-editor">
      <label class="ic-Label" for="content-title">Title</label>
      <input class="ic-Input" id="content-title" value="${escapeHtml(item?.title || "")}" required>
      <label class="ic-Label" for="content-body">Content</label>
      <textarea class="ic-Input text-area" id="content-body" rows="7">${escapeHtml(item?.body || "")}</textarea>
      ${["quiz", "outcome"].includes(config.kind) ? `<label class="ic-Label" for="content-points">Points</label><input class="ic-Input" id="content-points" type="number" min="0" step="0.5" value="${item?.points_possible ?? ""}">` : ""}
      ${config.kind === "quiz" ? `<label class="ic-Label" for="content-due">Due</label><input class="ic-Input" id="content-due" type="datetime-local" value="${inputDateTime(item?.due_at)}">` : ""}
      <label class="remember"><input id="content-published" type="checkbox" ${item?.published === false ? "" : "checked"}> Published</label>
      <div class="dialog-actions"><button class="Button" type="button" data-cancel-editor>Cancel</button><button class="Button Button--primary" type="submit">Save</button></div>
    </form>`);
  document.querySelector("[data-cancel-editor]").addEventListener("click", closeDialog);
  document.querySelector("#content-editor").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      user_id: state.user.id,
      title: document.querySelector("#content-title").value,
      body: document.querySelector("#content-body").value,
      points_possible: document.querySelector("#content-points")?.value ? Number(document.querySelector("#content-points").value) : null,
      due_at: document.querySelector("#content-due")?.value ? new Date(document.querySelector("#content-due").value).toISOString() : null,
      published: document.querySelector("#content-published").checked,
    };
    const url = `/api/courses/${state.currentCourse.course.id}/content/${config.kind}${item ? `/${item.id}` : ""}`;
    await request(url, { method: item ? "PUT" : "POST", body: JSON.stringify(payload) });
    closeDialog();
    showFlash(`${config.singular} saved`);
    await loadCourse(state.currentCourse.course.id, tab);
  });
}

async function openDiscussion(item) {
  const replies = await request(`/api/discussions/${item.id}/replies?user_id=${state.user.id}`);
  openDialog(item.title, `<div class="canvas-content-body discussion-prompt">${escapeHtml(item.body).replaceAll("\n", "<br>")}</div><div class="discussion-thread">${replies.map((reply) => `<article class="discussion-reply ${reply.parent_id ? "nested" : ""}"><span class="person-avatar">${initials(reply.author.name)}</span><div><strong>${escapeHtml(reply.author.name)}</strong><time>${formatDate(reply.created_at)}</time><p>${escapeHtml(reply.body)}</p><div class="reply-actions"><button class="link-button" data-reply-to="${reply.id}">Reply</button><button class="link-button" data-like-reply="${reply.id}">Like (${reply.likes})</button></div></div></article>`).join("") || '<p class="muted">No replies yet.</p>'}</div><form id="discussion-reply-form"><label class="ic-Label" for="discussion-reply-body">Reply</label><textarea class="ic-Input text-area" id="discussion-reply-body" required></textarea><input type="hidden" id="discussion-parent"><div class="dialog-actions"><span class="muted" id="reply-context"></span><button class="Button Button--primary">Post Reply</button></div></form>`);
  document.querySelectorAll("[data-reply-to]").forEach((button) => button.addEventListener("click", () => { document.querySelector("#discussion-parent").value = button.dataset.replyTo; document.querySelector("#reply-context").textContent = "Replying to a message"; document.querySelector("#discussion-reply-body").focus(); }));
  document.querySelectorAll("[data-like-reply]").forEach((button) => button.addEventListener("click", async () => { await request(`/api/discussions/replies/${button.dataset.likeReply}/like?user_id=${state.user.id}`, { method: "POST" }); await openDiscussion(item); }));
  document.querySelector("#discussion-reply-form").addEventListener("submit", async (event) => { event.preventDefault(); await request(`/api/discussions/${item.id}/replies`, { method: "POST", body: JSON.stringify({ user_id: state.user.id, body: document.querySelector("#discussion-reply-body").value, parent_id: Number(document.querySelector("#discussion-parent").value) || null }) }); await openDiscussion(item); });
}

async function openQuiz(item) {
  const questions = await request(`/api/quizzes/${item.id}/questions?user_id=${state.user.id}`);
  if (state.user.role === "instructor") {
    openDialog(item.title, `<p>${escapeHtml(item.body)}</p><div class="quiz-questions">${questions.map((question, index) => `<article class="quiz-question"><strong>Question ${index + 1}</strong><p>${escapeHtml(question.prompt)}</p><small>${question.points} pts · Correct: ${escapeHtml(question.correct_answer)}</small><button class="Button Button--small" data-delete-question="${question.id}">Delete</button></article>`).join("") || '<p class="muted">No questions.</p>'}</div><button class="Button Button--primary" data-new-question>+ New Question</button>`);
    document.querySelector("[data-new-question]").addEventListener("click", () => openQuestionEditor(item));
    document.querySelectorAll("[data-delete-question]").forEach((button) => button.addEventListener("click", async () => { await request(`/api/quizzes/${item.id}/questions/${button.dataset.deleteQuestion}?user_id=${state.user.id}`, { method: "DELETE" }); await openQuiz(item); }));
    return;
  }
  openDialog(item.title, `<form id="quiz-attempt"><p>${escapeHtml(item.body)}</p>${questions.map((question, index) => `<fieldset class="quiz-question"><legend>${index + 1}. ${escapeHtml(question.prompt)} <small>${question.points} pts</small></legend>${question.options.map((option) => `<label><input type="radio" name="question-${question.id}" value="${escapeHtml(option)}" required> ${escapeHtml(option)}</label>`).join("")}</fieldset>`).join("")}<div class="dialog-actions"><button class="Button Button--primary">Submit Quiz</button></div></form>`);
  document.querySelector("#quiz-attempt").addEventListener("submit", async (event) => { event.preventDefault(); const answers = {}; questions.forEach((question) => { answers[String(question.id)] = new FormData(event.target).get(`question-${question.id}`); }); const result = await request(`/api/quizzes/${item.id}/attempts`, { method: "POST", body: JSON.stringify({ user_id: state.user.id, answers }) }); openDialog("Quiz Results", `<div class="quiz-result"><strong>${result.score} / ${result.points_possible}</strong><p>Your attempt has been graded.</p></div>`); });
}

function openQuestionEditor(quiz) {
  openDialog("New Question", '<form id="question-editor"><label class="ic-Label" for="question-prompt">Question</label><textarea class="ic-Input text-area" id="question-prompt" required></textarea><label class="ic-Label" for="question-options">Options (one per line)</label><textarea class="ic-Input text-area" id="question-options" required></textarea><label class="ic-Label" for="question-answer">Correct Answer</label><input class="ic-Input" id="question-answer" required><label class="ic-Label" for="question-points">Points</label><input class="ic-Input" id="question-points" type="number" min="0" step="0.5" value="1" required><div class="dialog-actions"><button class="Button Button--primary">Create Question</button></div></form>');
  document.querySelector("#question-editor").addEventListener("submit", async (event) => { event.preventDefault(); await request(`/api/quizzes/${quiz.id}/questions`, { method: "POST", body: JSON.stringify({ user_id: state.user.id, prompt: document.querySelector("#question-prompt").value, options: document.querySelector("#question-options").value.split("\n").map((value) => value.trim()).filter(Boolean), correct_answer: document.querySelector("#question-answer").value.trim(), points: Number(document.querySelector("#question-points").value) }) }); await openQuiz(quiz); });
}

async function openOutcome(item) {
  const mastery = await request(`/api/courses/${state.currentCourse.course.id}/mastery?user_id=${state.user.id}`);
  const result = mastery.find((entry) => entry.outcome_id === item.id);
  const alignment = state.user.role === "instructor" ? `<form id="outcome-align"><label class="ic-Label" for="outcome-assignment">Align an assignment</label><select class="ic-Input" id="outcome-assignment">${state.currentCourse.assignments.map((assignment) => `<option value="${assignment.id}">${escapeHtml(assignment.title)}</option>`).join("")}</select><button class="Button Button--primary">Align</button></form>` : "";
  openDialog(item.title, `<p>${escapeHtml(item.body)}</p><div class="mastery-card"><strong>${result?.mastery == null ? "Not yet assessed" : `${result.mastery}% mastery`}</strong><span>${result?.aligned_assignments || 0} aligned assignments</span></div>${alignment}`);
  document.querySelector("#outcome-align")?.addEventListener("submit", async (event) => { event.preventDefault(); await request(`/api/outcomes/${item.id}/alignments`, { method: "POST", body: JSON.stringify({ user_id: state.user.id, assignment_id: Number(document.querySelector("#outcome-assignment").value) }) }); showFlash("Outcome aligned"); await openOutcome(item); });
}

function assignmentPayload(item = null) {
  return `
    <form id="assignment-editor">
      <label class="ic-Label" for="assignment-title">Assignment Name</label>
      <input class="ic-Input" id="assignment-title" value="${escapeHtml(item?.title || "")}" required>
      <label class="ic-Label" for="assignment-description">Description</label>
      <textarea class="ic-Input text-area" id="assignment-description" rows="6">${escapeHtml(item?.description || "")}</textarea>
      <div class="form-grid">
        <div><label class="ic-Label" for="assignment-points">Points</label><input class="ic-Input" id="assignment-points" type="number" min="0" step="0.5" value="${item?.points_possible ?? 10}" required></div>
        <div><label class="ic-Label" for="assignment-due">Due</label><input class="ic-Input" id="assignment-due" type="datetime-local" value="${inputDateTime(item?.due_at || new Date())}" required></div>
      </div>
      <fieldset class="canvas-fieldset"><legend>Submission Types</legend>
        <label><input type="checkbox" name="submission-type" value="online_text_entry" ${(item?.submission_types || ["online_text_entry"]).includes("online_text_entry") ? "checked" : ""}> Text Entry</label>
        <label><input type="checkbox" name="submission-type" value="online_url" ${(item?.submission_types || []).includes("online_url") ? "checked" : ""}> Website URL</label>
        <label><input type="checkbox" name="submission-type" value="online_upload" ${(item?.submission_types || []).includes("online_upload") ? "checked" : ""}> File Upload</label>
      </fieldset>
      <label class="remember"><input id="assignment-published" type="checkbox" ${item?.published === false ? "" : "checked"}> Published</label>
      <div class="dialog-actions"><button class="Button" type="button" data-cancel-assignment>Cancel</button><button class="Button Button--primary" type="submit">Save</button></div>
    </form>`;
}

function openAssignmentEditor(item = null) {
  openDialog(item ? "Edit Assignment" : "Add Assignment", assignmentPayload(item));
  document.querySelector("[data-cancel-assignment]").addEventListener("click", closeDialog);
  document.querySelector("#assignment-editor").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submissionTypes = [...document.querySelectorAll('[name="submission-type"]:checked')].map((input) => input.value);
    if (!submissionTypes.length) return showFlash("Select at least one submission type");
    const payload = {
      user_id: state.user.id,
      title: document.querySelector("#assignment-title").value,
      description: document.querySelector("#assignment-description").value,
      due_at: new Date(document.querySelector("#assignment-due").value).toISOString(),
      points_possible: Number(document.querySelector("#assignment-points").value),
      submission_types: submissionTypes,
      published: document.querySelector("#assignment-published").checked,
    };
    const base = `/api/courses/${state.currentCourse.course.id}/assignments`;
    await request(item ? `${base}/${item.id}` : base, { method: item ? "PUT" : "POST", body: JSON.stringify(payload) });
    closeDialog();
    showFlash("Assignment saved");
    await loadCourse(state.currentCourse.course.id, "assignments");
  });
}

function bindAssignmentActions() {
  document.querySelector("[data-new-assignment]")?.addEventListener("click", () => openAssignmentEditor());
  document.querySelectorAll("[data-assignment-edit]").forEach((button) => button.addEventListener("click", () => {
    openAssignmentEditor(state.currentCourse.assignments.find((item) => item.id === Number(button.dataset.assignmentEdit)));
  }));
  document.querySelectorAll("[data-assignment-delete]").forEach((button) => button.addEventListener("click", async () => {
    const item = state.currentCourse.assignments.find((entry) => entry.id === Number(button.dataset.assignmentDelete));
    if (!window.confirm(`Delete "${item.title}" and its submissions?`)) return;
    await request(`/api/courses/${state.currentCourse.course.id}/assignments/${item.id}?user_id=${state.user.id}`, { method: "DELETE" });
    showFlash("Assignment deleted");
    await loadCourse(state.currentCourse.course.id, "assignments");
  }));
}

function openSubmissionEditor(assignment) {
  openDialog(`Submit: ${assignment.title}`, `
    <form id="submission-editor">
      <p class="muted">Choose one or more submission types allowed by this assignment.</p>
      ${assignment.submission_types.includes("online_text_entry") ? '<label class="ic-Label" for="submission-text">Text Entry</label><textarea class="ic-Input text-area" id="submission-text" rows="7"></textarea>' : ""}
      ${assignment.submission_types.includes("online_url") ? '<label class="ic-Label" for="submission-url">Website URL</label><input class="ic-Input" id="submission-url" type="url" placeholder="https://">' : ""}
      ${assignment.submission_types.includes("online_upload") ? '<label class="ic-Label" for="submission-file">File</label><input class="ic-Input" id="submission-file" type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.zip">' : ""}
      <div class="dialog-actions"><button class="Button" type="button" data-cancel-submission>Cancel</button><button class="Button Button--primary" type="submit">Submit Assignment</button></div>
    </form>`);
  document.querySelector("[data-cancel-submission]").addEventListener("click", closeDialog);
  document.querySelector("#submission-editor").addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = document.querySelector("#submission-file")?.files[0];
    const textEntry = document.querySelector("#submission-text")?.value || "";
    const websiteUrl = document.querySelector("#submission-url")?.value || "";
    if (file) {
      const form = new FormData();
      form.append("user_id", state.user.id);
      form.append("upload", file);
      await request(`/api/assignments/${assignment.id}/submissions/file`, { method: "POST", body: form });
    } else {
      await request(`/api/assignments/${assignment.id}/submissions`, { method: "POST", body: JSON.stringify({ user_id: state.user.id, text_entry: textEntry, website_url: websiteUrl }) });
    }
    closeDialog();
    showFlash("Submission received");
    await loadCourse(state.currentCourse.course.id, "assignments");
  });
}

async function renderModulesTab(root) {
  root.innerHTML = '<div class="loading-state"><span class="spinner"></span><p>Loading modules...</p></div>';
  try {
    const modules = await request(`/api/courses/${state.currentCourse.course.id}/modules?user_id=${state.user.id}`);
    const actions = state.user.role === "instructor" ? '<button class="Button Button--primary" data-new-module>+ Module</button>' : "";
    root.innerHTML = `${courseHeader("Modules", actions)}${modules.map((module) => `<section class="item-group"><div class="item-group-header"><h2>${escapeHtml(module.name)}</h2><div class="row-actions"><span class="published-icon">${module.published ? "✓" : "○"}</span>${state.user.role === "instructor" ? `<button class="Button Button--small" data-add-module-item="${module.id}">+ Item</button><button class="Button Button--small" data-delete-module="${module.id}">Delete</button>` : ""}</div></div>${module.items.map((item) => `<div class="content-row"><span class="content-row-icon">▧</span><div><span class="content-row-title">${escapeHtml(item.title)}</span><span class="content-row-meta">${escapeHtml(item.item_type)}</span></div>${state.user.role === "instructor" ? `<button class="Button Button--small" data-delete-module-item="${item.id}" data-module-id="${module.id}">Delete</button>` : '<span class="published-icon">✓</span>'}</div>`).join("") || '<div class="empty-state"><p>No items in this module.</p></div>'}</section>`).join("") || '<div class="empty-state"><p>No modules have been added.</p></div>'}`;
    bindModuleActions(modules);
  } catch (error) { root.innerHTML = `<div class="error-state"><p>${escapeHtml(error.message)}</p></div>`; }
}

function bindModuleActions(modules) {
  document.querySelector("[data-new-module]")?.addEventListener("click", () => openModuleEditor());
  document.querySelectorAll("[data-add-module-item]").forEach((button) => button.addEventListener("click", () => openModuleItemEditor(Number(button.dataset.addModuleItem))));
  document.querySelectorAll("[data-delete-module]").forEach((button) => button.addEventListener("click", async () => {
    const module = modules.find((item) => item.id === Number(button.dataset.deleteModule));
    if (!window.confirm(`Delete module "${module.name}"?`)) return;
    await request(`/api/courses/${state.currentCourse.course.id}/modules/${module.id}?user_id=${state.user.id}`, { method: "DELETE" });
    renderModulesTab(document.querySelector("#course-main"));
  }));
  document.querySelectorAll("[data-delete-module-item]").forEach((button) => button.addEventListener("click", async () => {
    await request(`/api/courses/${state.currentCourse.course.id}/modules/${button.dataset.moduleId}/items/${button.dataset.deleteModuleItem}?user_id=${state.user.id}`, { method: "DELETE" });
    renderModulesTab(document.querySelector("#course-main"));
  }));
}

function openModuleEditor() {
  openDialog("Add Module", '<form id="module-editor"><label class="ic-Label" for="module-name">Module Name</label><input class="ic-Input" id="module-name" required><div class="dialog-actions"><button class="Button" type="button" data-cancel-module>Cancel</button><button class="Button Button--primary">Add Module</button></div></form>');
  document.querySelector("[data-cancel-module]").addEventListener("click", closeDialog);
  document.querySelector("#module-editor").addEventListener("submit", async (event) => { event.preventDefault(); await request(`/api/courses/${state.currentCourse.course.id}/modules`, { method: "POST", body: JSON.stringify({ user_id: state.user.id, name: document.querySelector("#module-name").value }) }); closeDialog(); renderModulesTab(document.querySelector("#course-main")); });
}

function openModuleItemEditor(moduleId) {
  openDialog("Add Module Item", `<form id="module-item-editor"><label class="ic-Label" for="module-item-title">Name</label><input class="ic-Input" id="module-item-title" required><label class="ic-Label" for="module-item-type">Type</label><select class="ic-Input" id="module-item-type"><option value="page">Page</option><option value="assignment">Assignment</option><option value="resource">File or Link</option><option value="external_url">External URL</option></select><label class="ic-Label" for="module-item-url">URL (optional)</label><input class="ic-Input" id="module-item-url" type="url"><div class="dialog-actions"><button class="Button" type="button" data-cancel-module-item>Cancel</button><button class="Button Button--primary">Add Item</button></div></form>`);
  document.querySelector("[data-cancel-module-item]").addEventListener("click", closeDialog);
  document.querySelector("#module-item-editor").addEventListener("submit", async (event) => { event.preventDefault(); await request(`/api/courses/${state.currentCourse.course.id}/modules/${moduleId}/items`, { method: "POST", body: JSON.stringify({ user_id: state.user.id, title: document.querySelector("#module-item-title").value, item_type: document.querySelector("#module-item-type").value, external_url: document.querySelector("#module-item-url").value }) }); closeDialog(); renderModulesTab(document.querySelector("#course-main")); });
}

function bindFileActions() {
  document.querySelector("[data-upload-file]")?.addEventListener("click", () => {
    openDialog("Upload File", '<form id="file-upload-form"><label class="ic-Label" for="course-file">Choose a file (maximum 20 MB)</label><input class="ic-Input" id="course-file" type="file" required accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.zip"><div class="dialog-actions"><button class="Button" type="button" data-cancel-file>Cancel</button><button class="Button Button--primary">Upload</button></div></form>');
    document.querySelector("[data-cancel-file]").addEventListener("click", closeDialog);
    document.querySelector("#file-upload-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(); form.append("user_id", state.user.id); form.append("upload", document.querySelector("#course-file").files[0]); await request(`/api/courses/${state.currentCourse.course.id}/resources/upload`, { method: "POST", body: form }); closeDialog(); await loadCourse(state.currentCourse.course.id, "files"); });
  });
  document.querySelector("[data-add-link]")?.addEventListener("click", () => {
    openDialog("Add Link", '<form id="resource-link-form"><label class="ic-Label" for="resource-title">Name</label><input class="ic-Input" id="resource-title" required><label class="ic-Label" for="resource-url">URL</label><input class="ic-Input" id="resource-url" type="url" required><div class="dialog-actions"><button class="Button" type="button" data-cancel-link>Cancel</button><button class="Button Button--primary">Add</button></div></form>');
    document.querySelector("[data-cancel-link]").addEventListener("click", closeDialog);
    document.querySelector("#resource-link-form").addEventListener("submit", async (event) => { event.preventDefault(); await request(`/api/courses/${state.currentCourse.course.id}/resources`, { method: "POST", body: JSON.stringify({ user_id: state.user.id, title: document.querySelector("#resource-title").value, kind: "link", source_url: document.querySelector("#resource-url").value }) }); closeDialog(); await loadCourse(state.currentCourse.course.id, "files"); });
  });
  document.querySelectorAll("[data-delete-resource]").forEach((button) => button.addEventListener("click", async () => { if (!window.confirm("Delete this file or link?")) return; await request(`/api/courses/${state.currentCourse.course.id}/resources/${button.dataset.deleteResource}?user_id=${state.user.id}`, { method: "DELETE" }); await loadCourse(state.currentCourse.course.id, "files"); }));
}

async function bindPeopleActions() {
  document.querySelector("[data-add-person]")?.addEventListener("click", async () => {
    const users = (await request("/api/users")).filter((user) => !state.currentCourse.people.some((person) => person.id === user.id));
    openDialog("Add People", `<form id="add-person-form"><label class="ic-Label" for="person-user">User</label><select class="ic-Input" id="person-user" required>${users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)} (${escapeHtml(user.email)})</option>`).join("")}</select><label class="ic-Label" for="person-role">Role</label><select class="ic-Input" id="person-role"><option value="student">Student</option><option value="instructor">Teacher</option></select><div class="dialog-actions"><button class="Button" type="button" data-cancel-person>Cancel</button><button class="Button Button--primary">Add</button></div></form>`);
    document.querySelector("[data-cancel-person]").addEventListener("click", closeDialog);
    document.querySelector("#add-person-form").addEventListener("submit", async (event) => { event.preventDefault(); await request(`/api/courses/${state.currentCourse.course.id}/enrollments`, { method: "POST", body: JSON.stringify({ user_id: state.user.id, member_id: Number(document.querySelector("#person-user").value), role: document.querySelector("#person-role").value }) }); closeDialog(); await loadCourse(state.currentCourse.course.id, "people"); });
  });
  document.querySelectorAll("[data-remove-person]").forEach((button) => button.addEventListener("click", async () => { if (!window.confirm("Remove this enrollment?")) return; await request(`/api/courses/${state.currentCourse.course.id}/enrollments/${button.dataset.removePerson}?user_id=${state.user.id}`, { method: "DELETE" }); await loadCourse(state.currentCourse.course.id, "people"); }));
}

function renderCourseSettings(root) {
  const course = state.currentCourse.course;
  root.innerHTML = `${courseHeader("Course Details")}<form id="course-settings" class="item-group settings-form"><label class="ic-Label" for="settings-name">Name</label><input class="ic-Input" id="settings-name" value="${escapeHtml(course.name)}" required><label class="ic-Label" for="settings-code">Course Code</label><input class="ic-Input" id="settings-code" value="${escapeHtml(course.code)}" required><label class="ic-Label" for="settings-term">Term</label><input class="ic-Input" id="settings-term" value="${escapeHtml(course.term)}" required><label class="ic-Label" for="settings-color">Course Color</label><input class="ic-Input color-input" id="settings-color" type="color" value="${escapeHtml(course.color)}"><label class="remember"><input id="settings-published" type="checkbox" checked> Published</label><div class="dialog-actions"><button class="Button Button--primary">Update Course Details</button><button class="Button Button--danger" type="button" data-delete-course>Delete This Course</button></div></form>`;
  document.querySelector("#course-settings").addEventListener("submit", async (event) => { event.preventDefault(); await request(`/api/courses/${course.id}/settings`, { method: "PUT", body: JSON.stringify({ user_id: state.user.id, code: document.querySelector("#settings-code").value, name: document.querySelector("#settings-name").value, term: document.querySelector("#settings-term").value, color: document.querySelector("#settings-color").value, published: document.querySelector("#settings-published").checked }) }); showFlash("Course settings updated"); await loadDashboard(); });
  document.querySelector("[data-delete-course]").addEventListener("click", async () => { if (!window.confirm(`Permanently delete ${course.name}?`)) return; await request(`/api/courses/${course.id}?user_id=${state.user.id}`, { method: "DELETE" }); showFlash("Course deleted"); await loadDashboard(); });
}

function bindGradebookActions() {
  document.querySelectorAll("[data-speedgrader]").forEach((button) => button.addEventListener("click", () => openSpeedGrader(Number(button.dataset.speedgrader))));
  document.querySelectorAll("[data-grade-assignment]").forEach((button) => button.addEventListener("click", () => openGradeEditor(Number(button.dataset.gradeAssignment), Number(button.dataset.gradeStudent))));
  document.querySelector("[data-export-grades]")?.addEventListener("click", exportGrades);
}

async function openSpeedGrader(assignmentId) {
  const assignment = state.currentCourse.assignments.find((item) => item.id === assignmentId);
  const submissions = await request(`/api/assignments/${assignmentId}/submissions?user_id=${state.user.id}`);
  openDialog(`SpeedGrader: ${assignment.title}`, `<div class="speedgrader-list">${submissions.map((submission) => `<button class="content-row" data-speedgrade-student="${submission.user_id}"><span class="person-avatar">${initials(submission.student_name)}</span><div><span class="content-row-title">${escapeHtml(submission.student_name)}</span><span class="content-row-meta">${submission.workflow_state} · ${submission.score ?? "Not graded"}</span></div><span>›</span></button>`).join("") || '<div class="empty-state"><p>No submissions yet.</p></div>'}</div>`);
  document.querySelectorAll("[data-speedgrade-student]").forEach((button) => button.addEventListener("click", () => openGradeEditor(assignmentId, Number(button.dataset.speedgradeStudent))));
}

async function openGradeEditor(assignmentId, studentId) {
  const assignment = state.currentCourse.assignments.find((item) => item.id === assignmentId);
  const student = state.currentCourse.people.find((item) => item.id === studentId);
  const submissions = await request(`/api/assignments/${assignmentId}/submissions?user_id=${state.user.id}`);
  const submission = submissions.find((item) => item.user_id === studentId);
  openDialog(`Grade: ${student?.name || "Student"}`, `<div class="submission-preview"><h3>${escapeHtml(assignment.title)}</h3>${submission?.text_entry ? `<p>${escapeHtml(submission.text_entry)}</p>` : ""}${submission?.website_url ? `<p><a href="${escapeHtml(submission.website_url)}" target="_blank">Open submitted URL</a></p>` : ""}${submission?.file_url ? `<p><a href="${escapeHtml(submission.file_url)}?user_id=${state.user.id}" target="_blank">Download ${escapeHtml(submission.file_name)}</a></p>` : ""}${!submission ? '<p class="muted">This student has not submitted.</p>' : ""}</div><form id="grade-editor"><label class="ic-Label" for="grade-score">Grade out of ${assignment.points_possible}</label><input class="ic-Input" id="grade-score" type="number" min="0" max="${assignment.points_possible}" step="0.1" value="${submission?.score ?? ""}" required><label class="ic-Label" for="grade-comment">Assignment Comments</label><textarea class="ic-Input text-area" id="grade-comment">${escapeHtml(submission?.instructor_comment || "")}</textarea><fieldset class="canvas-fieldset"><legend>Rubric</legend><div class="form-grid"><label>Understanding<input class="ic-Input" data-rubric="understanding" type="number" min="0" max="4" step="1" value="${submission?.rubric?.understanding ?? 0}"></label><label>Accuracy<input class="ic-Input" data-rubric="accuracy" type="number" min="0" max="4" step="1" value="${submission?.rubric?.accuracy ?? 0}"></label><label>Process<input class="ic-Input" data-rubric="process" type="number" min="0" max="4" step="1" value="${submission?.rubric?.process ?? 0}"></label></div></fieldset><div class="dialog-actions"><button class="Button Button--primary">Update Grade</button></div></form>`);
  document.querySelector("#grade-editor").addEventListener("submit", async (event) => { event.preventDefault(); const rubric = {}; document.querySelectorAll("[data-rubric]").forEach((input) => { rubric[input.dataset.rubric] = Number(input.value); }); await request(`/api/assignments/${assignmentId}/submissions/${studentId}/grade`, { method: "PUT", body: JSON.stringify({ user_id: state.user.id, score: Number(document.querySelector("#grade-score").value), comment: document.querySelector("#grade-comment").value, rubric }) }); closeDialog(); showFlash("Grade updated"); await loadCourse(state.currentCourse.course.id, "grades"); });
}

function exportGrades() {
  const assignments = state.currentCourse.assignments;
  const rows = [["Student", ...assignments.map((item) => item.title)], ...state.currentCourse.gradebook.map((row) => [row.name, ...row.grades.map((grade) => grade.score ?? "")])];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = `${state.currentCourse.course.code}-grades.csv`; link.click(); URL.revokeObjectURL(link.href);
}

function bindSubmitButtons() {
  document.querySelectorAll("[data-submit]").forEach((button) => {
    button.addEventListener("click", async () => {
      openSubmissionEditor(state.currentCourse.assignments.find((item) => item.id === Number(button.dataset.submit)));
    });
  });
}

async function renderCalendar() {
  closeTray();
  setActiveNav("calendar");
  recordHistory("Calendar", renderCalendar);
  showLoading();
  state.calendarItems = await request(`/api/calendar/${state.user.id}`);
  paintCalendar();
}

function paintCalendar() {
  const current = state.calendarDate;
  const year = current.getFullYear();
  const month = current.getMonth();
  const firstDay = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstDay.getDay());
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    const events = state.calendarItems.filter((item) => {
      const due = new Date(item.starts_at);
      const visible = state.calendarFilter === "all" || String(item.course_id || "personal") === state.calendarFilter;
      return visible && due.getFullYear() === day.getFullYear() && due.getMonth() === day.getMonth() && due.getDate() === day.getDate();
    });
    const dateKey = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).toISOString();
    return `<div class="calendar-cell ${day.getMonth() !== month ? "outside" : ""}" data-calendar-date="${dateKey}"><span class="calendar-day">${day.getDate()}</span>${events.map((item) => `<button class="calendar-event" style="--event-color:${item.color}" data-calendar-item="${item.id}" draggable="${item.editable}">${escapeHtml(item.title)}</button>`).join("")}</div>`;
  }).join("");
  const filter = `<select class="Button" data-calendar-filter><option value="all">All Calendars</option><option value="personal" ${state.calendarFilter === "personal" ? "selected" : ""}>${escapeHtml(state.user.name)}</option>${state.dashboard.courses.map((course) => `<option value="${course.id}" ${state.calendarFilter === String(course.id) ? "selected" : ""}>${escapeHtml(course.name)}</option>`).join("")}</select>`;
  mainContent.innerHTML = `${courseHeader("Calendar", `${filter}<button class="Button" data-calendar-today>Today</button><button class="Button Button--primary" data-new-event>+ Event</button>`)}<div class="calendar-toolbar"><button class="Button" data-calendar-prev>‹</button><h2>${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(current)}</h2><button class="Button" data-calendar-next>›</button></div><p class="muted calendar-hint">Drag a personal event to another day to reschedule it.</p><div class="calendar-grid">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div class="calendar-cell calendar-weekday">${day}</div>`).join("")}${cells}</div>`;
  document.querySelector("[data-calendar-prev]").addEventListener("click", () => { state.calendarDate = new Date(year, month - 1, 1); paintCalendar(); });
  document.querySelector("[data-calendar-next]").addEventListener("click", () => { state.calendarDate = new Date(year, month + 1, 1); paintCalendar(); });
  document.querySelector("[data-calendar-today]").addEventListener("click", () => { state.calendarDate = new Date(); paintCalendar(); });
  document.querySelector("[data-new-event]").addEventListener("click", () => openCalendarEditor());
  document.querySelector("[data-calendar-filter]").addEventListener("change", (event) => { state.calendarFilter = event.target.value; paintCalendar(); });
  document.querySelectorAll("[data-calendar-item]").forEach((button) => {
    button.addEventListener("click", () => openCalendarItem(state.calendarItems.find((item) => item.id === button.dataset.calendarItem)));
  });
  document.querySelectorAll('[data-calendar-item][draggable="true"]').forEach((button) => button.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", button.dataset.calendarItem)));
  document.querySelectorAll("[data-calendar-date]").forEach((cell) => {
    cell.addEventListener("dragover", (event) => event.preventDefault());
    cell.addEventListener("drop", async (event) => {
      event.preventDefault();
      const item = state.calendarItems.find((entry) => entry.id === event.dataTransfer.getData("text/plain"));
      if (!item?.editable) return;
      const oldDate = new Date(item.starts_at); const target = new Date(cell.dataset.calendarDate); target.setHours(oldDate.getHours(), oldDate.getMinutes(), 0, 0);
      await request(`/api/calendar/${item.source_id}`, { method: "PUT", body: JSON.stringify({ user_id: state.user.id, course_id: item.course_id, title: item.title, description: item.description || "", starts_at: target.toISOString(), ends_at: null, repeat_count: 1 }) });
      await renderCalendar();
    });
  });
}

function openCalendarItem(item) {
  if (item.type === "assignment") {
    loadCourse(item.course_id, "assignments");
    return;
  }
  openDialog(item.title, `<p>${escapeHtml(item.description || "No details")}</p><p class="muted">${formatLongDate(item.starts_at)} · ${formatDate(item.starts_at)}</p><div class="dialog-actions"><button class="Button" data-edit-event>Edit</button><button class="Button" data-delete-event>Delete</button></div>`);
  document.querySelector("[data-edit-event]").addEventListener("click", () => openCalendarEditor(item));
  document.querySelector("[data-delete-event]").addEventListener("click", async () => {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    await request(`/api/calendar/${item.source_id}?user_id=${state.user.id}`, { method: "DELETE" });
    closeDialog();
    await renderCalendar();
  });
}

function openCalendarEditor(item = null) {
  openDialog(`${item ? "Edit" : "New"} Event`, `
    <form id="calendar-editor">
      <label class="ic-Label" for="event-title">Title</label><input class="ic-Input" id="event-title" value="${escapeHtml(item?.title || "")}" required>
      <label class="ic-Label" for="event-date">Date and time</label><input class="ic-Input" id="event-date" type="datetime-local" value="${inputDateTime(item?.starts_at || state.calendarDate)}" required>
      <label class="ic-Label" for="event-course">Calendar</label><select class="ic-Input" id="event-course"><option value="">${escapeHtml(state.user.name)}</option>${state.dashboard.courses.map((course) => `<option value="${course.id}" ${item?.course_id === course.id ? "selected" : ""}>${escapeHtml(course.name)}</option>`).join("")}</select>
      <label class="ic-Label" for="event-description">Details</label><textarea class="ic-Input text-area" id="event-description" rows="5">${escapeHtml(item?.description || "")}</textarea>
      ${item ? "" : '<label class="ic-Label" for="event-repeat">Repeat weekly</label><select class="ic-Input" id="event-repeat"><option value="1">Does not repeat</option><option value="2">2 weeks</option><option value="4">4 weeks</option><option value="8">8 weeks</option><option value="12">12 weeks</option></select>'}
      <div class="dialog-actions"><button class="Button" type="button" data-cancel-event>Cancel</button><button class="Button Button--primary" type="submit">Submit</button></div>
    </form>`);
  document.querySelector("[data-cancel-event]").addEventListener("click", closeDialog);
  document.querySelector("#calendar-editor").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      user_id: state.user.id,
      course_id: document.querySelector("#event-course").value ? Number(document.querySelector("#event-course").value) : null,
      title: document.querySelector("#event-title").value,
      description: document.querySelector("#event-description").value,
      starts_at: new Date(document.querySelector("#event-date").value).toISOString(),
      ends_at: null,
      repeat_count: Number(document.querySelector("#event-repeat")?.value || 1),
    };
    await request(`/api/calendar${item ? `/${item.source_id}` : ""}`, { method: item ? "PUT" : "POST", body: JSON.stringify(payload) });
    closeDialog();
    showFlash("Event saved");
    await renderCalendar();
  });
}

async function renderInbox() {
  closeTray();
  setActiveNav("inbox");
  recordHistory("Inbox", renderInbox);
  showLoading();
  state.conversations = await request(`/api/inbox/${state.user.id}?box=${state.inboxBox}`);
  if (!state.selectedConversationId && state.conversations.length) state.selectedConversationId = state.conversations[0].id;
  paintInbox();
}

function paintInbox() {
  const selected = state.conversations.find((item) => item.id === state.selectedConversationId);
  const list = state.conversations.map((conversation) => {
    const others = conversation.participants.filter((participant) => participant.id !== state.user.id);
    const lastMessage = conversation.messages.at(-1);
    return `<button class="conversation-list-item ${selected?.id === conversation.id ? "selected" : ""} ${conversation.unread ? "unread" : ""}" data-conversation="${conversation.id}"><strong>${conversation.unread ? "● " : ""}${escapeHtml(others.map((item) => item.name).join(", ") || state.user.name)}</strong><span>${escapeHtml(conversation.subject)}</span><small>${escapeHtml(lastMessage?.body || "")}</small></button>`;
  }).join("");
  const detail = selected ? `
    <div class="conversation-detail">
      <header><h2>${escapeHtml(selected.subject)}</h2><span>${escapeHtml(selected.participants.map((item) => item.name).join(", "))}</span></header>
      <div class="message-thread">${selected.messages.map((message) => `<article class="message"><div class="person-avatar">${initials(message.sender.name)}</div><div><strong>${escapeHtml(message.sender.name)}</strong><time>${formatDate(message.created_at)}</time><p>${escapeHtml(message.body).replaceAll("\n", "<br>")}</p>${message.attachments.map((file) => `<a href="${escapeHtml(file.file_url)}?user_id=${state.user.id}" target="_blank">📎 ${escapeHtml(file.file_name)}</a>`).join("")}</div></article>`).join("")}</div>
      <form class="reply-box" id="reply-form"><textarea class="ic-Input text-area" id="reply-body" rows="4" placeholder="Reply"></textarea><input id="reply-attachment" type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.zip"><div><button class="Button" type="button" data-toggle-unread>${selected.unread ? "Mark Read" : "Mark Unread"}</button><button class="Button" type="button" data-archive>${selected.archived ? "Move to Inbox" : "Archive"}</button><button class="Button Button--primary" type="submit">Send</button></div></form>
    </div>` : '<div class="inbox-empty"><div><div style="font-size:42px">✉</div><p>No conversations selected</p></div></div>';
  mainContent.innerHTML = `${courseHeader("Inbox", '<button class="Button Button--primary" data-compose>Compose a new message</button>')}<div class="inbox-toolbar">${[["inbox", "Inbox"], ["unread", "Unread"], ["sent", "Sent"], ["archived", "Archived"]].map(([key, label]) => `<button class="Button ${state.inboxBox === key ? "Button--primary" : ""}" data-inbox-box="${key}">${label}</button>`).join("")}</div><div class="inbox-layout"><div class="inbox-list">${list || '<div class="empty-state"><p>No conversations.</p></div>'}</div>${detail}</div>`;
  document.querySelector("[data-compose]").addEventListener("click", openComposeMessage);
  document.querySelectorAll("[data-inbox-box]").forEach((button) => button.addEventListener("click", () => { state.inboxBox = button.dataset.inboxBox; state.selectedConversationId = null; renderInbox(); }));
  document.querySelectorAll("[data-conversation]").forEach((button) => {
    button.addEventListener("click", async () => { state.selectedConversationId = Number(button.dataset.conversation); await request(`/api/inbox/${state.selectedConversationId}/state`, { method: "PUT", body: JSON.stringify({ user_id: state.user.id, unread: false }) }); const conversation = state.conversations.find((item) => item.id === state.selectedConversationId); conversation.unread = false; paintInbox(); });
  });
  document.querySelector("#reply-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = document.querySelector("#reply-body").value.trim();
    const file = document.querySelector("#reply-attachment").files[0];
    if (!body && !file) return;
    if (file) { const form = new FormData(); form.append("sender_id", state.user.id); form.append("body", body); form.append("upload", file); await request(`/api/inbox/${selected.id}/attachments`, { method: "POST", body: form }); await renderInbox(); }
    else { const updated = await request(`/api/inbox/${selected.id}/messages`, { method: "POST", body: JSON.stringify({ sender_id: state.user.id, body }) }); state.conversations = state.conversations.map((item) => item.id === updated.id ? updated : item); paintInbox(); }
  });
  document.querySelector("[data-toggle-unread]")?.addEventListener("click", async () => { await request(`/api/inbox/${selected.id}/state`, { method: "PUT", body: JSON.stringify({ user_id: state.user.id, unread: !selected.unread }) }); await renderInbox(); });
  document.querySelector("[data-archive]")?.addEventListener("click", async () => { await request(`/api/inbox/${selected.id}/state`, { method: "PUT", body: JSON.stringify({ user_id: state.user.id, archived: !selected.archived }) }); state.selectedConversationId = null; await renderInbox(); });
}

async function openComposeMessage() {
  const users = (await request("/api/users")).filter((user) => user.id !== state.user.id);
  openDialog("Compose Message", `
    <form id="compose-form">
      <label class="ic-Label" for="message-recipient">To (Ctrl/Cmd-click to select a group)</label><select class="ic-Input multi-select" id="message-recipient" multiple required>${users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`).join("")}</select>
      <label class="ic-Label" for="message-subject">Subject</label><input class="ic-Input" id="message-subject" required>
      <label class="ic-Label" for="message-body">Message</label><textarea class="ic-Input text-area" id="message-body" rows="7" required></textarea>
      <div class="dialog-actions"><button class="Button" type="button" data-cancel-message>Cancel</button><button class="Button Button--primary" type="submit">Send</button></div>
    </form>`);
  document.querySelector("[data-cancel-message]").addEventListener("click", closeDialog);
  document.querySelector("#compose-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const conversation = await request("/api/inbox", {
      method: "POST",
      body: JSON.stringify({
        sender_id: state.user.id,
        recipient_ids: [...document.querySelector("#message-recipient").selectedOptions].map((option) => Number(option.value)),
        subject: document.querySelector("#message-subject").value,
        body: document.querySelector("#message-body").value,
      }),
    });
    closeDialog();
    state.selectedConversationId = conversation.id;
    await renderInbox();
    showFlash("Message sent");
  });
}

function renderHistory() {
  closeTray();
  setActiveNav("history");
  mainContent.innerHTML = `${courseHeader("Recent History")}<div class="item-group">${state.history.map((item, index) => `<button class="content-row" data-history="${index}" style="width:100%;background:#fff;border-left:0;border-right:0;border-top:0;text-align:left"><span class="content-row-icon">◷</span><div><span class="content-row-title">${escapeHtml(item.label)}</span><span class="content-row-meta">${formatLongDate(item.at)}</span></div><span>›</span></button>`).join("") || '<div class="empty-state"><p>No recent page views.</p></div>'}</div>`;
  document.querySelectorAll("[data-history]").forEach((button) => button.addEventListener("click", () => state.history[Number(button.dataset.history)].action()));
}

async function logout() {
  try {
    await request("/api/session", { method: "DELETE" });
  } catch (_) {
    // Clear local session even if the server is temporarily unavailable.
  }
  sessionStorage.removeItem("canvas_access_token");
  sessionStorage.removeItem("canvas_csrf_token");
  localStorage.removeItem("canvas_user_id");
  state.user = null;
  state.accessToken = null;
  state.csrfToken = null;
  state.dashboard = null;
  state.currentCourse = null;
  state.history = [];
  closeTray();
  appShell.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  document.querySelector("#password").value = "";
}

document.querySelectorAll("[data-nav]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(".ic-app-header").classList.remove("open");
    const target = button.dataset.nav;
    if (target === "dashboard") loadDashboard();
    else if (target === "account") openAccountTray();
    else if (target === "courses") openCoursesTray();
    else if (target === "calendar") renderCalendar();
    else if (target === "inbox") renderInbox();
    else if (target === "history") renderHistory();
    else if (target === "help") openHelpTray();
  });
});

document.querySelector("#mobile-menu").addEventListener("click", () => {
  document.querySelector(".ic-app-header").classList.toggle("open");
});
document.querySelector("#dialog-close").addEventListener("click", closeDialog);
dialog.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(); });

async function restoreSession() {
  if (!state.accessToken) return;
  try {
    const data = await request("/api/session/me");
    state.user = data.user;
    document.querySelector("#nav-avatar").textContent = initials(state.user.name);
    loginScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    await loadDashboard();
  } catch (_) {
    sessionStorage.removeItem("canvas_access_token");
    sessionStorage.removeItem("canvas_csrf_token");
    localStorage.removeItem("canvas_user_id");
    state.accessToken = null;
    state.csrfToken = null;
  }
}

restoreSession();
