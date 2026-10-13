        const modeSelect = document.getElementById('report-mode-select');
        const factionFilters = Array.from(
            document.querySelectorAll('[data-faction-filter]'));
        const chartFactionFilters = Array.from(
            document.querySelectorAll('[data-chart-faction]'));
        const encounterChart = document.getElementById('encounter-chart');
        const encounterDurationSeconds = Number(encounterChart.dataset.duration);
        const encounterStartEpoch = Number(encounterChart.dataset.startEpoch);
        let encounterSelectionStart = 0;
        let encounterSelectionEnd = encounterDurationSeconds;
        let draggedSelectionBound = null;
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
                const start = scale.getPixelForValue(encounterSelectionStart);
                const end = scale.getPixelForValue(encounterSelectionEnd);
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
                [encounterSelectionStart, encounterSelectionEnd].forEach(
                    function (value) {
                        const x = scale.getPixelForValue(value);
                        context.beginPath();
                        context.moveTo(x, area.top);
                        context.lineTo(x, area.bottom);
                        context.stroke();
                    });
                context.restore();
            },
        };
        Chart.register(selectionOverlayPlugin);
        const chartOptions = function (showSelection) {
            return {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: {intersect: false, mode: 'index'},
                layout: {padding: {left: 25, right: 5, top: 4, bottom: 4}},
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
                    const area = chart.chartArea;
                    const positionY = (event.clientY - bounds.top) *
                        chart.height / bounds.height;
                    if (positionX < area.left || positionX > area.right ||
                        positionY < area.top || positionY > area.bottom) return;

                    const scale = chart.scales.x;
                    const clickedOffset = scale.getValueForPixel(positionX);
                    const startX = scale.getPixelForValue(encounterSelectionStart);
                    const endX = scale.getPixelForValue(encounterSelectionEnd);
                    const nearStart = Math.abs(positionX - startX) <= 9;
                    const nearEnd = Math.abs(positionX - endX) <= 9;
                    draggedSelectionBound = event.button === 2
                        ? 'end'
                        : (nearStart && (!nearEnd ||
                            Math.abs(positionX - startX) <= Math.abs(positionX - endX))
                            ? 'start'
                            : (nearEnd ? 'end' : 'start'));
                    canvas.setPointerCapture(event.pointerId);
                    if (draggedSelectionBound === 'start') {
                        encounterSelectionStart = Math.max(0, Math.min(
                            encounterSelectionEnd - 1, Math.round(clickedOffset)));
                    } else {
                        encounterSelectionEnd = Math.max(encounterSelectionStart + 1,
                            Math.min(encounterDurationSeconds,
                                Math.round(clickedOffset) +
                                    (event.button === 2 ? 1 : 0)));
                    }
                    updateEncounterView();
                });
                canvas.addEventListener('pointermove', function (event) {
                    if (!draggedSelectionBound) return;
                    const bounds = canvas.getBoundingClientRect();
                    const positionX = (event.clientX - bounds.left) *
                        chart.width / bounds.width;
                    const offset = Math.round(chart.scales.x.getValueForPixel(positionX));
                    if (draggedSelectionBound === 'start') {
                        encounterSelectionStart = Math.max(0, Math.min(
                            encounterSelectionEnd - 1, offset));
                    } else {
                        encounterSelectionEnd = Math.max(encounterSelectionStart + 1,
                            Math.min(encounterDurationSeconds, offset));
                    }
                    scheduleEncounterViewUpdate();
                });
                const finishSelectionDrag = function () {
                    draggedSelectionBound = null;
                };
                canvas.addEventListener('pointerup', finishSelectionDrag);
                canvas.addEventListener('pointercancel', finishSelectionDrag);
                canvas.addEventListener('lostpointercapture', finishSelectionDrag);
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
        const targetBreakdownTooltip = document.createElement('div');
        targetBreakdownTooltip.className = 'target-breakdown-tooltip';
        targetBreakdownTooltip.id = 'target-breakdown-tooltip';
        targetBreakdownTooltip.setAttribute('role', 'tooltip');
        targetBreakdownTooltip.hidden = true;
        document.body.appendChild(targetBreakdownTooltip);
        let activeTargetBreakdownItem = null;
        let activeTargetBreakdownAnchor = null;
        const showTargetBreakdownTooltip = function (item, anchor) {
            activeTargetBreakdownItem = item;
            activeTargetBreakdownAnchor = anchor;
            const abilities = JSON.parse(item.dataset.abilities || '[]');
            targetBreakdownTooltip.replaceChildren();
            const heading = document.createElement('div');
            heading.className = 'target-breakdown-tooltip-heading';
            heading.textContent = item.dataset.targetName + ' damage by ability';
            targetBreakdownTooltip.appendChild(heading);

            const visibleAbilities = abilities.map(function (ability) {
                const hits = parseSeries(ability.hits).filter(function (hit) {
                    return hit[1] > 1 &&
                        hit[0] >= encounterSelectionStart &&
                        hit[0] < encounterSelectionEnd;
                });
                const total = hits.reduce(function (sum, hit) {
                    return sum + hit[1];
                }, 0);
                return {
                    ability: ability.ability,
                    icon: ability.icon,
                    hits: hits,
                    total: total,
                    average: hits.length ? total / hits.length : 0,
                    maximum: hits.reduce(function (max, hit) {
                        return Math.max(max, hit[1]);
                    }, 0)
                };
            }).filter(function (ability) {
                return ability.hits.length > 0;
            }).sort(function (left, right) {
                return right.total - left.total ||
                    left.ability.localeCompare(right.ability);
            });

            if (!visibleAbilities.length) {
                const empty = document.createElement('div');
                empty.className = 'target-breakdown-tooltip-empty';
                empty.textContent = 'No damage in the selected time range.';
                targetBreakdownTooltip.appendChild(empty);
            }
            const totalDamage = visibleAbilities.reduce(function (total, ability) {
                return total + ability.total;
            }, 0);
            visibleAbilities.forEach(function (ability) {
                const row = document.createElement('div');
                row.className = 'target-breakdown-tooltip-row';
                const headingRow = document.createElement('div');
                headingRow.className = 'target-breakdown-tooltip-ability-row';
                const nameGroup = document.createElement('span');
                nameGroup.className = 'target-breakdown-tooltip-name-group';
                let icon = null;
                if (ability.icon) {
                    icon = document.createElement('img');
                    icon.className = 'target-breakdown-tooltip-icon';
                    icon.src = ability.icon;
                    icon.alt = '';
                    icon.setAttribute('aria-hidden', 'true');
                }
                const name = document.createElement('span');
                name.className = 'target-breakdown-tooltip-ability';
                name.textContent = ability.ability;
                nameGroup.appendChild(name);
                const total = document.createElement('span');
                total.className = 'target-breakdown-tooltip-total';
                total.textContent = numberText(ability.total);
                headingRow.append(nameGroup, total);
                const barRow = document.createElement('div');
                barRow.className = 'target-breakdown-tooltip-bar-row';
                if (icon) barRow.appendChild(icon);
                const barTrack = document.createElement('div');
                barTrack.className = 'target-breakdown-tooltip-bar-track';
                const bar = document.createElement('div');
                bar.className = 'target-breakdown-tooltip-bar';
                bar.style.width = (totalDamage > 0
                    ? ability.total / totalDamage * 100
                    : 0).toFixed(1) + '%';
                barTrack.appendChild(bar);
                barRow.appendChild(barTrack);
                const metrics = document.createElement('span');
                metrics.className = 'target-breakdown-tooltip-metrics';
                metrics.textContent = 'Avg ' + numberText(ability.average) +
                    '  ·  Max ' + numberText(ability.maximum);
                row.append(headingRow, barRow, metrics);
                targetBreakdownTooltip.appendChild(row);
            });

            targetBreakdownTooltip.hidden = false;
            const anchorBounds = anchor.getBoundingClientRect();
            const tooltipBounds = targetBreakdownTooltip.getBoundingClientRect();
            const margin = 8;
            const left = Math.max(margin, Math.min(
                anchorBounds.left,
                window.innerWidth - tooltipBounds.width - margin));
            const above = anchorBounds.top - tooltipBounds.height - margin;
            const top = above >= margin
                ? above
                : Math.min(window.innerHeight - tooltipBounds.height - margin,
                    anchorBounds.bottom + margin);
            targetBreakdownTooltip.style.left = left + 'px';
            targetBreakdownTooltip.style.top = Math.max(margin, top) + 'px';
        };
        const hideTargetBreakdownTooltip = function () {
            targetBreakdownTooltip.hidden = true;
            activeTargetBreakdownItem = null;
            activeTargetBreakdownAnchor = null;
        };
        const shortNumberText = function (value) {
            if (value >= 1000000) return (value / 1000000).toFixed(1) + 'm';
            if (value >= 1000) return (value / 1000).toFixed(1) + 'k';
            return value.toFixed(0);
        };
        const updateAbilityTargetValues = function (list, start, end) {
            const values = Array.from(list.querySelectorAll('.ability-target-item')).map(
                function (item) {
                    return {
                        item: item,
                        total: seriesRange(
                            getElementSeriesStats(item, 'series'), start, end).total
                    };
                });
            const total = values.reduce(function (sum, value) {
                return sum + value.total;
            }, 0);
            values.forEach(function (value) {
                value.item.hidden = value.total <= 0;
                value.item.querySelector('.ability-target-amount').textContent =
                    numberText(value.total);
                const percent = total > 0 ? value.total / total * 100 : 0;
                value.item.querySelector('.ability-target-bar').style.width =
                    Math.max(0, Math.min(100, percent)).toFixed(1) + '%';
            });
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
            breakdown.querySelectorAll('.ability-target-list').forEach(function (list) {
                updateAbilityTargetValues(list, start, end);
            });
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
            const start = encounterSelectionStart;
            const end = encounterSelectionEnd;
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
            let eastTotal = 0;
            let westTotal = 0;
            let pirateTotal = 0;
            visibleRows.forEach(function (item) {
                if (item.row.classList.contains('faction-east')) {
                    eastTotal += item.amount;
                } else if (item.row.classList.contains('faction-west')) {
                    westTotal += item.amount;
                } else if (item.row.classList.contains('faction-pirate')) {
                    pirateTotal += item.amount;
                }
            });
            const eastAmountEl = document.getElementById('total-east-amount');
            if (eastAmountEl) eastAmountEl.textContent = numberText(eastTotal);
            const westAmountEl = document.getElementById('total-west-amount');
            if (westAmountEl) westAmountEl.textContent = numberText(westTotal);
            const pirateAmountEl = document.getElementById('total-pirate-amount');
            if (pirateAmountEl) pirateAmountEl.textContent = numberText(pirateTotal);
            const pirateRowEl = document.getElementById('total-pirate-row');
            if (pirateRowEl) {
                pirateRowEl.hidden = !visibleFactionFilters.has('Pirate');
            }
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
            if (activeTargetBreakdownItem && activeTargetBreakdownAnchor) {
                showTargetBreakdownTooltip(
                    activeTargetBreakdownItem, activeTargetBreakdownAnchor);
            }
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
        document.querySelectorAll('.encounter-time-input').forEach(function (input) {
            input.addEventListener('change', function () {
                const startBound = input.id === 'selected-start-time';
                const start = encounterSelectionStart;
                const end = encounterSelectionEnd;
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
                encounterSelectionStart = nextStart;
                encounterSelectionEnd = nextEnd;
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
        document.addEventListener('pointerover', function (event) {
            if (!(event.target instanceof Element)) return;
            const track = event.target.closest('.target-breakdown-bar');
            if (!track || (event.relatedTarget instanceof Node &&
                track.contains(event.relatedTarget))) return;
            const item = track.closest('.breakdown-target');
            if (item) showTargetBreakdownTooltip(item, track);
        });
        document.addEventListener('pointerout', function (event) {
            if (!(event.target instanceof Element)) return;
            const track = event.target.closest('.target-breakdown-bar');
            if (!track || (event.relatedTarget instanceof Node &&
                track.contains(event.relatedTarget))) return;
            hideTargetBreakdownTooltip();
        });
        document.addEventListener('focusin', function (event) {
            if (!(event.target instanceof Element)) return;
            const track = event.target.closest('.target-breakdown-bar');
            if (!track) return;
            const item = track.closest('.breakdown-target');
            if (item) showTargetBreakdownTooltip(item, track);
        });
        document.addEventListener('focusout', function (event) {
            if (!(event.target instanceof Element)) return;
            if (event.target.closest('.target-breakdown-bar')) {
                hideTargetBreakdownTooltip();
            }
        });
        document.addEventListener('click', function (event) {
            const abilityToggle = event.target.closest('.ability-target-toggle');
            if (abilityToggle) {
                const targetList = document.getElementById(
                    abilityToggle.getAttribute('data-target'));
                if (!targetList) return;
                const isExpanded =
                    abilityToggle.getAttribute('aria-expanded') === 'true';
                abilityToggle.setAttribute('aria-expanded', String(!isExpanded));
                abilityToggle.textContent = isExpanded ? '+' : '-';
                abilityToggle.setAttribute('aria-label', isExpanded
                    ? 'Show targets damaged by ' + abilityToggle.dataset.ability
                    : 'Hide targets damaged by ' + abilityToggle.dataset.ability);
                targetList.hidden = isExpanded;
                if (!isExpanded) {
                    updateAbilityTargetValues(
                        targetList, encounterSelectionStart, encounterSelectionEnd);
                }
                return;
            }
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
                    const start = encounterSelectionStart;
                    const end = encounterSelectionEnd;
                    updateBreakdownValues(toggle.closest('tr.player-row'), start, end);
                    renderPlayerChart(toggle.closest('tr.player-row'), start, end);
                    resizeCharts(target);
                });
            }
        });
