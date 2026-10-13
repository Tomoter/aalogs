(() => {
    "use strict";

    const script = document.currentScript;
    const reportsPath = (script?.dataset.reportsPath || "reports")
        .replace(/^\/+|\/+$/g, "");
    const ownerOverride = script?.dataset.owner || "";
    const repositoryOverride = script?.dataset.repository || "";
    const refOverride = script?.dataset.ref || "";
    const results = document.getElementById("report-results");
    const status = document.getElementById("report-status");
    const refreshButton = document.getElementById("refresh-reports");
    const apiRoot = "https://api.github.com";
    let repositoryInfo;
    let refreshing = false;

    function setStatus(message) {
        status.textContent = message;
    }

    function encodePath(value) {
        return value.split("/").map(encodeURIComponent).join("/");
    }

    function repositoryCoordinates() {
        if (ownerOverride && repositoryOverride) {
            return { owner: ownerOverride, repository: repositoryOverride };
        }
        const hostSuffix = ".github.io";
        const hostname = location.hostname.toLowerCase();
        if (hostname.endsWith(hostSuffix)) {
            const owner = hostname.slice(0, -hostSuffix.length);
            const pathSegments = location.pathname.split("/").filter(Boolean);
            const repository = repositoryOverride ||
                (pathSegments.length ? decodeURIComponent(pathSegments[0]) : `${owner}.github.io`);
            if (owner && repository) {
                return { owner, repository };
            }
        }
        throw new Error(
            "Could not infer the GitHub repository from this site URL. " +
            "Set data-owner and data-repository on the pages-index.js script element.",
        );
    }

    async function fetchJson(url, description) {
        const response = await fetch(url, {
            cache: "no-store",
            headers: {
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        });
        if (!response.ok) {
            if (response.status === 403 || response.status === 429) {
                throw new Error(
                    "GitHub API rate limit reached. Wait a while, then refresh the page.",
                );
            }
            throw new Error(`${description} failed (HTTP ${response.status}).`);
        }
        return response.json();
    }

    async function getRepositoryInfo() {
        if (repositoryInfo) {
            return repositoryInfo;
        }
        const { owner, repository } = repositoryCoordinates();
        const endpoint = `${apiRoot}/repos/${encodeURIComponent(owner)}/` +
            `${encodeURIComponent(repository)}`;
        repositoryInfo = await fetchJson(endpoint, "Loading repository information");
        repositoryInfo.owner = owner;
        repositoryInfo.repository = repository;
        repositoryInfo.ref = refOverride || repositoryInfo.default_branch;
        if (!repositoryInfo.ref) {
            throw new Error("GitHub did not return a default branch for this repository.");
        }
        return repositoryInfo;
    }

    function formatDate(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value || "");
        if (!match) {
            return value || "Time unavailable";
        }
        const [, year, month, day, hour, minute] = match;
        const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
        if (date.getUTCMonth() !== Number(month) - 1 ||
            date.getUTCDate() !== Number(day)) {
            return value;
        }
        const monthName = new Intl.DateTimeFormat("en", {
            month: "long",
            timeZone: "UTC",
        }).format(date);
        return `${monthName} ${Number(day)} ${hour}:${minute}`;
    }

    function folderDate(folderName) {
        const match =
            /^(?:report|previous)-(\d{4}-\d{2}-\d{2})_(\d{2})[:-](\d{2})[:-]\d+.*$/
                .exec(folderName);
        return match ? `${match[1]} ${match[2]}:${match[3]}:00` : "";
    }

    async function loadMetadata(info, reportPath, folderName) {
        const metadataPath = `${reportPath}/report.json`;
        try {
            const sameOriginResp = await fetch(encodePath(metadataPath), { cache: "no-store" });
            if (sameOriginResp.ok) {
                return await sameOriginResp.json();
            }
        } catch {}
        const url = `https://raw.githubusercontent.com/${encodeURIComponent(info.owner)}/` +
            `${encodeURIComponent(info.repository)}/${encodePath(info.ref)}/` +
            `${encodePath(metadataPath)}`;
        try {
            const response = await fetch(url, { cache: "no-store" });
            if (response.ok) {
                return await response.json();
            }
        } catch {}
        return {};
    }

    async function loadReports(info) {
        const treeUrl = `${apiRoot}/repos/${encodeURIComponent(info.owner)}/` +
            `${encodeURIComponent(info.repository)}/git/trees/${encodePath(info.ref)}?recursive=1`;
        const tree = await fetchJson(treeUrl, "Listing report folders");
        if (tree.truncated) {
            throw new Error(
                "The repository is too large for GitHub's recursive tree listing. " +
                "The live API listing is unavailable for repositories of this size.",
            );
        }

        const prefix = reportsPath ? `${reportsPath}/` : "";
        const reportsByDirectory = new Map();
        for (const item of tree.tree || []) {
            if (item.type !== "blob" || !/\.html?$/i.test(item.path)) {
                continue;
            }
            let folder = "";
            let filename = "";
            let folderPath = "";
            if (prefix && item.path.startsWith(prefix)) {
                const relative = item.path.slice(prefix.length);
                const separator = relative.indexOf("/");
                if (separator > 0) {
                    folder = relative.slice(0, separator);
                    filename = relative.slice(separator + 1);
                    if (!filename.includes("/")) {
                        folderPath = `${prefix}${folder}`;
                    }
                }
            }
            if (!folder) {
                const match = /(?:^|\/)(report-[^\/]+|previous-[^\/]+)\/([^\/]+\.html?)$/i.exec(item.path);
                if (match) {
                    folder = match[1];
                    filename = match[2];
                    folderPath = item.path.slice(0, item.path.length - filename.length - 1);
                }
            }
            if (!folder || !filename) {
                continue;
            }
            const key = folderPath || folder;
            if (!reportsByDirectory.has(key)) {
                reportsByDirectory.set(key, { folder, folderPath: key, htmlFiles: [] });
            }
            reportsByDirectory.get(key).htmlFiles.push({ filename, path: item.path });
        }

        const reports = [];
        for (const [, group] of reportsByDirectory) {
            const folder = group.folder;
            const folderPath = group.folderPath;
            const metadata = await loadMetadata(info, folderPath, folder);
            const reportDate = metadata.dateTime || folderDate(folder);
            const sortedFiles = group.htmlFiles.sort((left, right) =>
                (left.filename.toLowerCase() === "index.html" ? -1 : 0) -
                (right.filename.toLowerCase() === "index.html" ? -1 : 0) ||
                left.filename.localeCompare(right.filename));
            for (const file of sortedFiles) {
                reports.push({
                    folder,
                    name: metadata.reportName || folder,
                    date: formatDate(reportDate),
                    uploaded: formatDate(metadata.uploadedAt || ""),
                    uploader: metadata.uploaderName || "Beefstew",
                    href: encodePath(file.path),
                    sortDate: reportDate,
                });
            }
        }
        return reports.sort((left, right) =>
            right.sortDate.localeCompare(left.sortDate));
    }

    function renderReports(reports) {
        results.replaceChildren();
        if (!reports.length) {
            const empty = document.createElement("p");
            empty.className = "empty";
            empty.textContent = "No reports have been generated yet.";
            results.append(empty);
            return;
        }

        const list = document.createElement("ul");
        list.className = "report-list";
        for (const report of reports) {
            const item = document.createElement("li");
            item.className = "report-entry";
            const link = document.createElement("a");
            link.className = "report-link";
            link.href = report.href;

            const title = document.createElement("span");
            title.className = "report-main";
            title.textContent = `${report.name} - ${report.date}`;
            const byline = document.createElement("span");
            byline.className = "report-byline";
            const uploaded = document.createElement("span");
            uploaded.className = "report-uploaded";
            uploaded.textContent = report.uploaded || "Upload time unavailable";
            const uploader = document.createElement("span");
            uploader.className = "report-uploader";
            uploader.textContent = `by ${report.uploader}`;

            byline.append(uploaded, uploader);
            link.append(title, byline);
            item.append(link);
            list.append(item);
        }
        results.append(list);
    }

    async function refresh() {
        if (refreshing) {
            return;
        }
        refreshing = true;
        refreshButton.disabled = true;
        setStatus("Checking GitHub for reports...");
        try {
            const info = await getRepositoryInfo();
            const reports = await loadReports(info);
            renderReports(reports);
            setStatus(
                `${reports.length} report${reports.length === 1 ? "" : "s"} found. ` +
                `Updated ${new Date().toLocaleTimeString()}.`,
            );
        } catch (error) {
            const hasExisting = Boolean(results.querySelector(".report-entry"));
            if (!hasExisting) {
                results.replaceChildren();
                const message = document.createElement("p");
                message.className = "empty";
                message.textContent = error instanceof Error
                    ? error.message
                    : "Could not load reports from GitHub.";
                results.append(message);
                setStatus("Report list could not be refreshed.");
            } else {
                const count = results.querySelectorAll(".report-entry").length;
                setStatus(`Showing ${count} saved report${count === 1 ? "" : "s"}.`);
            }
            console.error("GitHub Pages report index:", error);
        } finally {
            refreshing = false;
            refreshButton.disabled = false;
        }
    }

    if (!results || !status || !refreshButton) {
        console.error("GitHub Pages report index is missing required page elements.");
        return;
    }
    refreshButton.addEventListener("click", refresh);
    if (location.protocol === "file:") {
        const count = results.querySelectorAll(".report-entry").length;
        setStatus(count > 0
            ? `Showing ${count} local report${count === 1 ? "" : "s"}.`
            : "No local reports found in this folder.");
    } else {
        void refresh();
        window.setInterval(refresh, 5 * 60 * 1000);
    }
})();
