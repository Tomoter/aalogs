        const modeSelect = document.getElementById('report-mode-select');
        const factionFilters = Array.from(
            document.querySelectorAll('[data-faction-filter]'));
        const chartFactionFilters = Array.from(
            document.querySelectorAll('[data-chart-faction]'));
        const encounterChart = document.getElementById('encounter-chart');
        const encounterDurationSeconds = Number(encounterChart.dataset.duration);
        const encounterStartEpoch = Number(encounterChart.dataset.startEpoch);
        const startSlider = document.getElementById('encounter-start-slider');
        const endSlider = document.getElementById('encounter-end-slider');
        const clockTextAt = function (offset) {
            const date = new Date((encounterStartEpoch + offset) * 1000);
            return [date.getHours(), date.getMinutes(), date.getSeconds()]
                .map(function (part) { return String(part).padStart(2, '0'); }).join(':');
        };
        const offsetForTimeInput = function (value, currentOffset, maxOffset) {
            const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
            if (!match) return null;
            const hours = Number(match[1]);
            const minutes = Number(match[2]);
            const seconds = Number(match[3] || 0);
            if (hours > 23 || minutes > 59 || seconds > 59) return null;

            const startDate = new Date(encounterStartEpoch * 1000);
            const startSeconds = startDate.getHours() * 3600 +
                startDate.getMinutes() * 60 + startDate.getSeconds();
            const estimatedDay = Math.floor((startSeconds + currentOffset) / 86400);
            let bestOffset = null;
            let bestDistance = Infinity;
            for (let day = estimatedDay - 2; day <= estimatedDay + 2; day += 1) {
                const candidateDate = new Date(startDate);
                candidateDate.setHours(0, 0, 0, 0);
                candidateDate.setDate(candidateDate.getDate() + day);
                candidateDate.setHours(hours, minutes, seconds, 0);
                const offset = Math.round(candidateDate.getTime() / 1000 -
                    encounterStartEpoch);
                const distance = Math.abs(offset - currentOffset);
                if (offset >= 0 && offset <= maxOffset && distance < bestDistance) {
                    bestOffset = offset;
                    bestDistance = distance;
                }
            }
            return bestOffset;
        };
        const smoothingRadius = Math.max(0, Number(
            encounterChart.dataset.smoothingRadius));
        const chartSampleCount = Math.max(1, Math.min(
            Number(encounterChart.dataset.maxSamples), encounterDurationSeconds));
        const smoothRates = function (rates) {
            if (smoothingRadius === 0) return rates;
            return rates.map(function (_, index) {
                let weighted = 0;
                let totalWeight = 0;
                for (let sample = Math.max(0, index - smoothingRadius);
                     sample < Math.min(rates.length, index + smoothingRadius + 1); sample += 1) {
                    const weight = smoothingRadius + 1 - Math.abs(sample - index);
                    weighted += rates[sample] * weight;
                    totalWeight += weight;
                }
                return weighted / totalWeight;
            });
        };
        const selectionOverlayPlugin = {
            id: 'encounter-selection',
            beforeDatasetsDraw: function (chart) {
                if (chart.canvas.id !== 'encounter-chart-canvas' ||
                    !chart.options.plugins['encounter-selection'].enabled) return;
                const area = chart.chartArea;
                const scale = chart.scales.x;
                const start = scale.getPixelForValue(Number(startSlider.value));
                const end = scale.getPixelForValue(Number(endSlider.value));
                const context = chart.ctx;
                context.save();
                context.fillStyle = 'rgba(0,0,0,.28)';
                context.fillRect(area.left, area.top, Math.max(0, start - area.left),
                    area.bottom - area.top);
                context.fillRect(end, area.top, Math.max(0, area.right - end),
                    area.bottom - area.top);
                context.restore();
            },
            afterDatasetsDraw: function (chart) {
                if (chart.canvas.id !== 'encounter-chart-canvas' ||
                    !chart.options.plugins['encounter-selection'].enabled) return;
                const area = chart.chartArea;
                const scale = chart.scales.x;
                const context = chart.ctx;
                context.save();
                context.strokeStyle = '#edf3f8';
                context.lineWidth = 1;
                [Number(startSlider.value), Number(endSlider.value)].forEach(
                    function (value) {
                        const x = scale.getPixelForValue(value);
                        context.beginPath();
                        context.moveTo(x, area.top);
                        context.lineTo(x, area.bottom);
                        context.stroke();
                    });
                context.restore();
            },
            afterDraw: function (chart) {
                if (chart.canvas.id !== 'encounter-chart-canvas' ||
                    !chart.options.plugins['encounter-selection'].enabled) return;
                const area = chart.chartArea;
                const context = chart.ctx;
                context.save();
                context.fillStyle = '#9aa8b5';
                context.font = '9px "Segoe UI", sans-serif';
                context.textBaseline = 'top';
                context.textAlign = 'left';
                context.fillText(clockTextAt(0), area.left, area.bottom + 5);
                context.textAlign = 'right';
                context.fillText(clockTextAt(encounterDurationSeconds - 1),
                    area.right, area.bottom + 5);
                context.restore();
            }
        };
        Chart.register(selectionOverlayPlugin);
        const chartOptions = function (showSelection) {
            return {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: {intersect: false, mode: 'index'},
                layout: {padding: {left: 25, right: 5, top: 4, bottom: 20}},
                plugins: {
                    legend: {display: false},
                    'encounter-selection': {enabled: showSelection},
                    tooltip: {
                        callbacks: {
                            title: function (items) {
                                return items.length ? clockTextAt(items[0].parsed.x) : '';
                            },
                            label: function (item) {
                                const faction = item.dataset.label
                                    ? item.dataset.label + ': ' : '';
                                return faction +
                                    Math.round(item.parsed.y).toLocaleString('en-US') +
                                    (modeSelect.value === 'healing' ? ' HPS' : ' DPS');
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        min: 0,
                        max: encounterDurationSeconds,
                        grid: {display: false},
                        ticks: showSelection ? {display: false} : {
                            color: '#9aa8b5',
                            maxTicksLimit: 6,
                            callback: function (value) { return clockTextAt(value); }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {color: 'rgba(255,255,255,.08)'},
                        ticks: {
                            color: '#9aa8b5',
                            maxTicksLimit: 3,
                            callback: function (value) {
                                return Math.round(value).toLocaleString('en-US');
                            }
                        }
                    }
                }
            };
        };
        const playerCharts = new WeakMap();
        const makeChartPoints = function (rates, duration, start) {
            const binDuration = duration / rates.length;
            return rates.map(function (rate, index) {
                return {x: start + (index + 0.5) * binDuration, y: rate};
            });
        };
        const parseSeries = function (encoded) {
            const values = [];
            encoded.split(';').forEach(function (entry) {
                if (!entry) return;
                const parts = entry.split(':');
                values.push([Number(parts[0]), Number(parts[1])]);
            });
            return values;
        };
        const createSeriesStats = function (series) {
            const times = [];
            const totals = [0];
            const activeCounts = [0];
            series.forEach(function (entry) {
                times.push(entry[0]);
                totals.push(totals[totals.length - 1] + entry[1]);
                activeCounts.push(activeCounts[activeCounts.length - 1] +
                    (entry[1] > 0 ? 1 : 0));
            });
            return {times: times, totals: totals, activeCounts: activeCounts};
        };
        const lowerBoundTime = function (times, value) {
            let low = 0;
            let high = times.length;
            while (low < high) {
                const middle = low + Math.floor((high - low) / 2);
                if (times[middle] < value) low = middle + 1;
                else high = middle;
            }
            return low;
        };
        const seriesRange = function (stats, start, end) {
            const first = lowerBoundTime(stats.times, start);
            const last = lowerBoundTime(stats.times, end);
            return {
                total: stats.totals[last] - stats.totals[first],
                activeCount: stats.activeCounts[last] - stats.activeCounts[first]
            };
        };
        const aggregateSeries = function (encoded, sampleCount) {
            const buckets = Array(sampleCount).fill(0);
            parseSeries(encoded).forEach(function (entry) {
                const bucket = Math.min(sampleCount - 1,
                    Math.floor(entry[0] * sampleCount / encounterDurationSeconds));
                buckets[bucket] += entry[1];
            });
            return buckets;
        };
        const chartBinDuration = encounterDurationSeconds / chartSampleCount;
        const factionColors = {
            East: '#C83232',
            West: '#3678C8',
            Pirate: '#8E44AD'
        };
        const factionRates = {damage: {}, healing: {}};
        chartFactionFilters.forEach(function (filter) {
            const faction = filter.dataset.chartFaction;
            ['damage', 'healing'].forEach(function (mode) {
                const buckets = aggregateSeries(
                    encounterChart.dataset[
                        faction.toLowerCase() +
                        mode[0].toUpperCase() + mode.slice(1) + 'Series'],
                    chartSampleCount);
                factionRates[mode][faction] = smoothRates(
                    buckets.map(function (amount) {
                        return amount / chartBinDuration;
                    }));
            });
        });
        const updateHeaderChart = function (viewMode) {
            const healing = viewMode === 'healing';
            const canvas = document.getElementById('encounter-chart-canvas');
            document.querySelector('.encounter-faction-filters').classList.toggle(
                'healing-faction-chart', healing);
            let chart = playerCharts.get(canvas);
            if (!chart) {
                chart = new Chart(canvas, {
                    type: 'line',
                    data: {datasets: []},
                    options: chartOptions(true)
                });
                playerCharts.set(canvas, chart);
                canvas.addEventListener('pointerdown', function (event) {
                    if (event.button !== 0 && event.button !== 2) return;
                    if (event.button === 2) event.preventDefault();

                    const bounds = canvas.getBoundingClientRect();
                    const positionX = (event.clientX - bounds.left) *
                        chart.width / bounds.width;
                    const positionY = (event.clientY - bounds.top) *
                        chart.height / bounds.height;
                    const area = chart.chartArea;
                    if (positionX < area.left || positionX > area.right ||
                        positionY < area.top || positionY > area.bottom) return;

                    const clickedOffset = Math.max(0, Math.min(
                        encounterDurationSeconds - 1,
                        Math.round(chart.scales.x.getValueForPixel(positionX))));
                    let start = Number(startSlider.value);
                    let end = Number(endSlider.value);
                    if (event.button === 0) {
                        start = clickedOffset;
                        if (start >= end) {
                            end = Math.min(encounterDurationSeconds, start + 1);
                        }
                    } else {
                        end = clickedOffset + 1;
                        if (end <= start) {
                            start = Math.max(0, end - 1);
                        }
                    }
                    startSlider.value = start;
                    endSlider.value = end;
                    updateEncounterView();
                });
                canvas.addEventListener('contextmenu', function (event) {
                    event.preventDefault();
                });
            }
            const mode = healing ? 'healing' : 'damage';
            chart.data.datasets = chartFactionFilters
                    .filter(function (filter) {
                        return filter.checked && !filter.closest('label').hidden &&
                            filter.dataset['chart' +
                                mode[0].toUpperCase() + mode.slice(1)] === 'true';
                    })
                    .map(function (filter) {
                        const faction = filter.dataset.chartFaction;
                        const color = factionColors[faction];
                        return {
                            label: faction,
                            data: makeChartPoints(
                                factionRates[mode][faction], encounterDurationSeconds, 0),
                            borderColor: color,
                            backgroundColor: color,
                            borderWidth: 2,
                            pointRadius: 0,
                            tension: 0.2
                        };
                    });
            chart.update('none');
            canvas.setAttribute(
                'aria-label', healing
                    ? 'Total healing per second across the encounter'
                    : 'Faction DPS across the encounter');
        };
        const allRows = {
            damage: Array.from(document.querySelectorAll('#damage-view tr.player-row')),
            healing: Array.from(document.querySelectorAll('#healing-view tr.player-row'))
        };
        const rowSeries = new Map();
        const rowSeriesStats = new Map();
        Object.values(allRows).forEach(function (rows) {
            rows.forEach(function (row) {
                const series = parseSeries(row.dataset.series);
                rowSeries.set(row, series);
                rowSeriesStats.set(row, createSeriesStats(series));
            });
        });
        const elementSeriesStats = new WeakMap();
        const getElementSeriesStats = function (element, key) {
            let statsByKey = elementSeriesStats.get(element);
            if (!statsByKey) {
                statsByKey = {};
                elementSeriesStats.set(element, statsByKey);
            }
            if (!statsByKey[key]) {
                statsByKey[key] = createSeriesStats(
                    parseSeries(element.dataset[key]));
            }
            return statsByKey[key];
        };
        const numberText = function (value) {
            return Math.round(value).toLocaleString('en-US').replace(/,/g, ' ');
        };
        const shortNumberText = function (value) {
            if (value >= 1000000) return (value / 1000000).toFixed(1) + 'm';
            if (value >= 1000) return (value / 1000).toFixed(1) + 'k';
            return value.toFixed(0);
        };
        const updateBreakdownValues = function (row, start, end) {
            const breakdown = document.getElementById(
                row.querySelector('.toggle-breakdown').dataset.target);
            if (!breakdown || breakdown.hidden) return;
            const updateGroup = function (selector) {
                const items = Array.from(breakdown.querySelectorAll(selector));
                const values = items.map(function (item) {
                    const range = seriesRange(
                        getElementSeriesStats(item, 'series'), start, end);
                    return {item: item, total: range.total};
                });
                const groupTotal = values.reduce(function (sum, value) {
                    return sum + value.total;
                }, 0);
                values.forEach(function (value) {
                    const item = value.item;
                    item.hidden = value.total <= 0;
                    const amount = item.querySelector('.breakdown-amount');
                    if (item.dataset.kind === 'uptime') {
                        amount.textContent = value.total.toFixed(1) +
                            (value.total === 1 ? ' second' : ' seconds');
                    } else {
                        amount.textContent = numberText(value.total);
                    }
                    const percent = groupTotal > 0 ? value.total / groupTotal * 100 : 0;
                    item.querySelector('.breakdown-percent').textContent = percent.toFixed(1);
                    item.querySelector('.breakdown-bar').style.width =
                        Math.max(0, Math.min(100, percent)).toFixed(1) + '%';
                });
            };
            updateGroup('.breakdown-spell');
            updateGroup('.breakdown-target');
        };
        const updateTwistedSpearBreakdown = function (start, end) {
            const section = document.getElementById('twisted-spear-breakdown');
            if (!section) return;
            const rows = Array.from(section.querySelectorAll('.twisted-spear-row')).map(
                function (row) {
                    return {
                        row: row,
                        damage: seriesRange(
                            getElementSeriesStats(row, 'series'), start, end).total,
                        hits: seriesRange(
                            getElementSeriesStats(row, 'hitSeries'), start, end).total,
                        healing: seriesRange(
                            getElementSeriesStats(row, 'healingSeries'), start, end).total
                    };
                });
            rows.sort(function (left, right) {
                if (left.healing !== right.healing) return right.healing - left.healing;
                if (left.damage !== right.damage) return right.damage - left.damage;
                return left.row.querySelector('.twisted-spear-player').textContent.localeCompare(
                    right.row.querySelector('.twisted-spear-player').textContent);
            });
            const totalDamage = rows.reduce(function (sum, item) {
                return sum + item.damage;
            }, 0);
            const totalHealing = rows.reduce(function (sum, item) {
                return sum + item.healing;
            }, 0);
            const unattributedHealing = seriesRange(
                getElementSeriesStats(section, 'unattributedSeries'), start, end).total;
            let playersHit = 0;
            const tbody = section.querySelector('.twisted-spear-table tbody');
            rows.forEach(function (item) {
                if (item.hits > 0) playersHit += 1;
                const share = totalHealing > 0 ? item.healing / totalHealing * 100 : 0;
                item.row.querySelector('.twisted-spear-hits').textContent =
                    String(Math.round(item.hits));
                item.row.querySelector('.twisted-spear-damage').textContent =
                    numberText(item.damage);
                item.row.querySelector('.twisted-spear-healing').textContent =
                    numberText(item.healing);
                item.row.querySelector('.twisted-spear-bar').style.width =
                    Math.max(0, Math.min(100, share)).toFixed(1) + '%';
                item.row.querySelector('.twisted-spear-percent').textContent = share.toFixed(1);
                tbody.appendChild(item.row);
            });
            document.getElementById('twisted-spear-player-count').textContent =
                String(playersHit);
            document.getElementById('twisted-spear-total').textContent =
                numberText(totalHealing + unattributedHealing);
            document.getElementById('twisted-spear-attributed-total').textContent =
                numberText(totalHealing);
            document.getElementById('twisted-spear-unattributed-total').textContent =
                numberText(unattributedHealing);
            document.getElementById('twisted-spear-damage-total').textContent =
                numberText(totalDamage);
        };
        const updateFactionPlayerCounts = function (start, end) {
            const players = new Map();
            Object.values(allRows).forEach(function (rows) {
                rows.forEach(function (row) {
                    const name = row.querySelector('.player-name').textContent
                        .trim().toLocaleLowerCase();
                    let faction = 'Uncategorized';
                    if (row.classList.contains('faction-east')) faction = 'East';
                    else if (row.classList.contains('faction-west')) faction = 'West';
                    else if (row.classList.contains('faction-pirate')) faction = 'Pirate';
                    let player = players.get(name);
                    if (!player) {
                        player = {faction: faction, active: false};
                        players.set(name, player);
                    }
                    if (seriesRange(rowSeriesStats.get(row), start, end).activeCount > 0) {
                        player.active = true;
                    }
                });
            });
            const counts = {East: 0, West: 0, Pirate: 0, Uncategorized: 0};
            players.forEach(function (player) {
                if (player.active) counts[player.faction] += 1;
            });
            document.getElementById('boss-faction-counts').textContent =
                'East: ' + counts.East + ' | West: ' + counts.West +
                ' | Pirate: ' + counts.Pirate +
                ' | Uncategorized: ' + counts.Uncategorized;
        };
        const formatDuration = function (seconds) {
            const minutes = Math.floor(seconds / 60);
            const remainder = seconds % 60;
            return minutes + (minutes === 1 ? ' minute and ' : ' minutes and ') +
                remainder + (remainder === 1 ? ' second' : ' seconds');
        };
        const renderPlayerChart = function (row, start, end) {
            const breakdown = document.getElementById(
                row.querySelector('.toggle-breakdown').dataset.target);
            if (!breakdown || breakdown.hidden) return;
            const canvas = breakdown.querySelector('.player-chart-canvas');
            if (!canvas) return;
            const duration = Math.max(1, end - start);
            const sampleCount = Math.max(1, Math.min(chartSampleCount, duration));
            const binDuration = duration / sampleCount;
            const buckets = Array(sampleCount).fill(0);
            rowSeries.get(row).forEach(function (entry) {
                if (entry[0] < start || entry[0] >= end) return;
                const bin = Math.min(sampleCount - 1,
                    Math.floor((entry[0] - start) * sampleCount / duration));
                buckets[bin] += entry[1];
            });
            const rates = smoothRates(
                buckets.map(function (amount) { return amount / binDuration; }));
            const range = canvas.parentElement.parentElement.querySelector(
                '.player-chart-range');
            range.textContent = clockTextAt(start) + ' - ' +
                clockTextAt(Math.max(start, end - 1));
            let chart = playerCharts.get(canvas);
            if (!chart) {
                const color = canvas.dataset.color;
                chart = new Chart(canvas, {
                    type: 'line',
                    data: {datasets: [{
                        data: [],
                        borderColor: color,
                        backgroundColor: color,
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2
                    }]},
                    options: chartOptions(false)
                });
                playerCharts.set(canvas, chart);
            }
            chart.options.scales.x.min = start;
            chart.options.scales.x.max = end;
            chart.data.datasets[0].data = makeChartPoints(rates, duration, start);
            chart.update('none');
        };
        const updateEncounterView = function () {
            const start = Number(startSlider.value);
            const end = Number(endSlider.value);
            const selectedDuration = Math.max(1, end - start);
            const viewMode = modeSelect.value === 'healing' ? 'healing' : 'damage';
            updateHeaderChart(viewMode);
            updateFactionPlayerCounts(start, end);
            updateTwistedSpearBreakdown(start, end);
            const rowValues = allRows[viewMode].map(function (row) {
                const range = seriesRange(rowSeriesStats.get(row), start, end);
                return {
                    row: row,
                    amount: range.total,
                    activeSeconds: range.activeCount
                };
            });
            const visibleFactionFilters = new Set(factionFilters
                .filter(function (filter) { return filter.checked; })
                .map(function (filter) { return filter.dataset.factionFilter; }));
            const isFactionVisible = function (row) {
                if (row.classList.contains('faction-east')) {
                    return visibleFactionFilters.has('East');
                }
                if (row.classList.contains('faction-west')) {
                    return visibleFactionFilters.has('West');
                }
                if (row.classList.contains('faction-pirate')) {
                    return visibleFactionFilters.has('Pirate');
                }
                return visibleFactionFilters.has('Uncategorized');
            };
            rowValues.sort(function (left, right) {
                if (left.amount !== right.amount) return right.amount - left.amount;
                return left.row.querySelector('.player-name').textContent.localeCompare(
                    right.row.querySelector('.player-name').textContent);
            });
            const visibleRows = rowValues.filter(function (item) {
                return item.activeSeconds > 0 && isFactionVisible(item.row);
            });
            const reportTotal = visibleRows.reduce(function (total, item) {
                return total + item.amount;
            }, 0);
            document.getElementById('total-amount').textContent = numberText(reportTotal);
            const tbody = document.querySelector(
                viewMode === 'healing' ? '#healing-view tbody' : '#damage-view tbody');
            let visibleRank = 0;
            rowValues.forEach(function (item) {
                const row = item.row;
                const share = reportTotal > 0 ? item.amount / reportTotal * 100 : 0;
                row.querySelector('.contribution-value').textContent = share.toFixed(2) + '%';
                row.querySelector('.contribution-bar').style.width =
                    Math.max(0, Math.min(100, share)).toFixed(2) + '%';
                row.querySelector('.player-total').textContent = numberText(item.amount);
                row.querySelector('.player-rate').textContent =
                    shortNumberText(item.amount / selectedDuration);
                row.dataset.uptime =
                    (item.activeSeconds / selectedDuration * 100).toFixed(1);
                renderPlayerChart(row, start, end);
                updateBreakdownValues(row, start, end);
                const breakdown = document.getElementById(
                    row.querySelector('.toggle-breakdown').dataset.target);
                const visible = item.activeSeconds > 0 && isFactionVisible(row);
                row.hidden = !visible;
                if (breakdown && !visible) {
                    breakdown.hidden = true;
                    const toggle = row.querySelector('.toggle-breakdown');
                    toggle.setAttribute('aria-expanded', 'false');
                    toggle.textContent = '+';
                }
                if (visible) {
                    visibleRank += 1;
                    row.querySelector('.rank-value').textContent = visibleRank;
                }
                tbody.appendChild(row);
                if (breakdown) tbody.appendChild(breakdown);
            });
            document.getElementById('total-amount').textContent = numberText(reportTotal);
            document.getElementById('boss-duration').textContent =
                formatDuration(selectedDuration);
            document.getElementById('selected-start-time').value = clockTextAt(start);
            document.getElementById('selected-end-time').value =
                clockTextAt(Math.max(start, end - 1));
        };
        const resizeCharts = function (root) {
            root.querySelectorAll('canvas').forEach(function (canvas) {
                const chart = playerCharts.get(canvas);
                if (chart) chart.resize();
            });
        };
        let encounterViewUpdateRequested = false;
        const scheduleEncounterViewUpdate = function () {
            if (encounterViewUpdateRequested) return;
            encounterViewUpdateRequested = true;
            window.requestAnimationFrame(function () {
                encounterViewUpdateRequested = false;
                updateEncounterView();
            });
        };
        document.querySelectorAll('.encounter-range-control input[type="range"]')
            .forEach(function (slider) {
            slider.addEventListener('input', function () {
                let start = Number(startSlider.value);
                let end = Number(endSlider.value);
                if (slider.dataset.bound === 'start') {
                    start = Number(slider.value);
                } else {
                    end = Number(slider.value);
                }
                if (start >= end) {
                    if (slider.dataset.bound === 'start') {
                        end = Math.min(encounterDurationSeconds, start + 1);
                    } else {
                        start = Math.max(0, end - 1);
                    }
                }
                startSlider.value = start;
                endSlider.value = end;
                scheduleEncounterViewUpdate();
            });
        });
        document.querySelectorAll('.encounter-time-input').forEach(function (input) {
            input.addEventListener('change', function () {
                const startBound = input.id === 'selected-start-time';
                const start = Number(startSlider.value);
                const end = Number(endSlider.value);
                const currentOffset = startBound ? start : Math.max(start, end - 1);
                const selectedOffset = offsetForTimeInput(
                    input.value, currentOffset, encounterDurationSeconds - 1);
                if (selectedOffset === null) {
                    updateEncounterView();
                    return;
                }
                let nextStart = start;
                let nextEnd = end;
                if (startBound) {
                    nextStart = selectedOffset;
                    if (nextStart >= nextEnd) {
                        nextEnd = Math.min(encounterDurationSeconds, nextStart + 1);
                    }
                } else {
                    nextEnd = selectedOffset + 1;
                    if (nextEnd <= nextStart) {
                        nextStart = Math.max(0, nextEnd - 1);
                    }
                }
                startSlider.value = nextStart;
                endSlider.value = nextEnd;
                updateEncounterView();
            });
        });
        modeSelect.addEventListener('change', function () {
            const healing = modeSelect.value === 'healing';
            document.getElementById('damage-view').hidden = healing;
            document.getElementById('healing-view').hidden = !healing;
            document.getElementById('total-label').textContent =
                healing ? 'Total Healing: ' : 'Total Damage: ';
            updateEncounterView();
            window.requestAnimationFrame(function () {
                resizeCharts(document.getElementById(
                    healing ? 'healing-view' : 'damage-view'));
            });
        });
        factionFilters.forEach(function (filter) {
            filter.addEventListener('change', updateEncounterView);
        });
        chartFactionFilters.forEach(function (filter) {
            filter.addEventListener('change', function () {
                updateHeaderChart(modeSelect.value);
            });
        });
        updateEncounterView();
        document.addEventListener('click', function (event) {
            const toggle = event.target.closest('.toggle-breakdown');
            if (!toggle) return;
            const target = document.getElementById(toggle.getAttribute('data-target'));
            if (!target) return;
            const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', String(!isExpanded));
            toggle.textContent = isExpanded ? '+' : '-';
            const mode = modeSelect.value === 'healing' ? 'healing' : 'damage';
            toggle.setAttribute('aria-label', isExpanded
                ? 'Expand ' + mode + ' breakdown'
                : 'Collapse ' + mode + ' breakdown');
            target.hidden = isExpanded;
            if (!isExpanded) {
                window.requestAnimationFrame(function () {
                    const start = Number(startSlider.value);
                    const end = Number(endSlider.value);
                    updateBreakdownValues(toggle.closest('tr.player-row'), start, end);
                    renderPlayerChart(toggle.closest('tr.player-row'), start, end);
                    resizeCharts(target);
                });
            }
        });
