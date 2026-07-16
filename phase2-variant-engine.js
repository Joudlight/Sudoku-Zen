/* ═══════════════════════════════════════════════════════
   SUDOKU ZEN — PHASE 2: VARIANT ENGINE
   Single source of truth for all game variants.
   Every mode (Standard, Killer, Arrow, Thermo, Jigsaw,
   Hyper, Diagonal, and combinations) registers constraints
   through this engine.
   ═══════════════════════════════════════════════════════ */

const VariantEngine = {
  /** Active peer map: Array<Array<number>> — peers[i] = all cells conflicting with i. */
  peerMap: null,

  /** Active constraint data: Array of constraint objects. */
  constraints: null,

  /** Active region map (for Jigsaw). */
  regionMap: null,

  /**
   * Build the peer map for a given game state.
   * Combines all active rules (Rows, Cols, Boxes, Jigsaw, Diagonals, Hyper)
   * into a single peer lookup. Caches in this.peerMap.
   * @param {object} state - Game state with variant, size, regionMap, constraints
   * @returns {Array<Array<number>>} peers[i] = sorted array
   */
  buildPeerMap(state) {
    const variant = SZ.Variants[state.variant];
    if (!variant) return [];
    const rules = variant.rules();
    const N = state.size;
    const total = N * N;
    const peerSets = Array.from({ length: total }, () => new Set());

    for (const rule of rules) {
      const groups = rule.getGroups(state);
      for (const g of groups) {
        for (const i of g) {
          for (const j of g) {
            if (i !== j) peerSets[i].add(j);
          }
        }
      }
    }

    // Also add all cells within a killer cage as peers
    if (state.constraints) {
      for (const c of state.constraints) {
        if (c.type === 'killer' && c.cells) {
          for (const i of c.cells) {
            for (const j of c.cells) {
              if (i !== j) peerSets[i].add(j);
            }
          }
        }
      }
    }

    this.peerMap = peerSets.map(s => [...s].sort((a, b) => a - b));
    return this.peerMap;
  },

  /**
   * Validate a Jigsaw region map.
   * Must be an 81-element array where each value 0-8 represents a region,
   * each region has exactly 9 cells, and regions are fully connected.
   * @param {number[]} map - 81-element region map
   * @returns {boolean} true if valid
   */
  validateJigsawRegionMap(map) {
    if (!Array.isArray(map) || map.length !== 81) return false;
    const N = 9;
    const regionCounts = new Array(N).fill(0);
    const regionCells = Array.from({ length: N }, () => []);

    for (let i = 0; i < 81; i++) {
      const r = Math.floor(i / N), c = i % N;
      const rid = map[i];
      if (typeof rid !== 'number' || rid < 0 || rid >= N || !Number.isInteger(rid)) return false;
      regionCounts[rid]++;
      regionCells[rid].push(i);
    }

    // Each region must have exactly N cells
    if (!regionCounts.every(count => count === N)) return false;

    // Each region must be orthogonally connected
    for (let rid = 0; rid < N; rid++) {
      const cells = new Set(regionCells[rid]);
      const visited = new Set();
      const queue = [regionCells[rid][0]];
      visited.add(queue[0]);
      while (queue.length > 0) {
        const idx = queue.shift();
        const r = Math.floor(idx / N), c = idx % N;
        const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
        for (const [nr, nc] of neighbors) {
          if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
          const nidx = nr * N + nc;
          if (cells.has(nidx) && !visited.has(nidx)) {
            visited.add(nidx);
            queue.push(nidx);
          }
        }
      }
      if (visited.size !== N) return false;
    }

    return true;
  },

  /**
   * Check a Killer cage constraint.
   * No repeats, partial sum ≤ target, remaining cells can still reach target,
   * complete cage sums exactly.
   * @param {object} cage - { cells: number[], sum: number }
   * @param {function} getCellValue - (idx) => number
   * @returns {object} { valid: boolean, conflicts: Set<number> }
   */
  checkKillerConstraint(cage, getCellValue) {
    const n = cage.cells.length;
    let sum = 0, filled = 0;
    const seen = new Set();
    const duplicates = new Set();
    const hasValue = new Set();

    for (const ci of cage.cells) {
      const v = getCellValue(ci);
      if (v === 0 || v === undefined) continue;
      filled++;
      sum += v;
      if (hasValue.has(v)) duplicates.add(v);
      hasValue.add(v);
    }

    const conflicts = new Set();

    // Duplicate digits
    if (duplicates.size > 0) {
      for (const ci of cage.cells) {
        const v = getCellValue(ci);
        if (v && duplicates.has(v)) conflicts.add(ci);
      }
    }

    // Sum exceeded
    if (sum > cage.sum) {
      cage.cells.forEach(ci => { if (getCellValue(ci)) conflicts.add(ci); });
    }

    // Early completion: sum == target but cells remain empty
    const empty = n - filled;
    if (sum === cage.sum && empty > 0) {
      cage.cells.forEach(ci => { if (!getCellValue(ci)) conflicts.add(ci); });
    }

    // Futility: even max values (9 each) can't reach target
    if (sum + empty * 9 < cage.sum) {
      cage.cells.forEach(ci => conflicts.add(ci));
    }

    // Complete check: all filled but sum doesn't match
    if (filled === n && sum !== cage.sum) {
      cage.cells.forEach(ci => conflicts.add(ci));
    }

    return { valid: conflicts.size === 0, conflicts };
  },

  /**
   * Check an Arrow constraint.
   * Circle cell value must equal sum of all path cell values.
   * @param {object} arrow - { circle: number, path: number[] }
   * @param {function} getCellValue - (idx) => number
   * @returns {object} { valid: boolean, conflicts: Set<number> }
   */
  checkArrowConstraint(arrow, getCellValue) {
    const cv = getCellValue(arrow.circle);
    const conflicts = new Set();

    if (!cv) return { valid: true, conflicts }; // Not enough info yet

    let pathSum = 0, allFilled = true;
    for (const pi of arrow.path) {
      const pv = getCellValue(pi);
      if (!pv) { allFilled = false; break; }
      pathSum += pv;
    }

    if (allFilled) {
      if (pathSum !== cv) {
        conflicts.add(arrow.circle);
        arrow.path.forEach(pi => conflicts.add(pi));
      }
    } else if (pathSum > cv) {
      // Path filled so far already exceeds circle value
      for (const pi of arrow.path) {
        if (getCellValue(pi)) conflicts.add(pi);
      }
    }

    return { valid: conflicts.size === 0, conflicts };
  },

  /**
   * Check a Thermo constraint.
   * Values must strictly increase along the path.
   * @param {object} thermo - { cells: number[] }
   * @param {function} getCellValue - (idx) => number
   * @returns {object} { valid: boolean, conflicts: Set<number> }
   */
  checkThermoConstraint(thermo, getCellValue) {
    const conflicts = new Set();

    for (let i = 0; i < thermo.cells.length - 1; i++) {
      const a = getCellValue(thermo.cells[i]);
      const b = getCellValue(thermo.cells[i + 1]);
      if (a && b && a >= b) {
        conflicts.add(thermo.cells[i]);
        conflicts.add(thermo.cells[i + 1]);
      }
    }

    // Gap feasibility: difference between filled cells must be ≥ distance
    let lastFilledIdx = -1, lastFilledVal = 0;
    for (let i = 0; i < thermo.cells.length; i++) {
      const v = getCellValue(thermo.cells[i]);
      if (!v) continue;
      if (lastFilledIdx >= 0) {
        const gap = i - lastFilledIdx;
        const diff = v - lastFilledVal;
        if (diff <= gap) {
          // Not enough room: need at least diff > gap (strictly increasing)
          conflicts.add(thermo.cells[lastFilledIdx]);
          conflicts.add(thermo.cells[i]);
        }
      }
      lastFilledIdx = i;
      lastFilledVal = v;
    }

    return { valid: conflicts.size === 0, conflicts };
  },

  /**
   * Unified conflict detection — runs peer conflicts for the active peerMap,
   * then all constraint-specific checks (Killer, Arrow, Thermo).
   * @param {object} state - Game state
   * @param {function} getCellValue - (idx) => number | undefined
   * @returns {Set<number>} set of conflicting cell indices
   */
  findAllConflicts(state, getCellValue) {
    const N = state.size;
    const total = N * N;
    const conflicts = new Set();

    // Build peer map if needed
    if (!this.peerMap) this.buildPeerMap(state);

    // Peer conflicts: same digit appears in row/col/box/region
    for (let i = 0; i < total; i++) {
      const v = getCellValue(i);
      if (!v) continue;
      for (const p of this.peerMap[i]) {
        if (getCellValue(p) === v && p > i) {
          conflicts.add(i);
          conflicts.add(p);
        }
      }
    }

    // Constraint-specific conflicts
    if (state.constraints) {
      for (const c of state.constraints) {
        let result;
        switch (c.type) {
          case 'killer':
            result = this.checkKillerConstraint(c, getCellValue);
            break;
          case 'arrow':
            result = this.checkArrowConstraint(c, getCellValue);
            break;
          case 'thermo':
            result = this.checkThermoConstraint(c, getCellValue);
            break;
        }
        if (result && result.conflicts) {
          result.conflicts.forEach(i => conflicts.add(i));
        }
      }
    }

    return conflicts;
  },

  /**
   * Check if the puzzle is complete and valid.
   * All cells non-zero AND no conflicts.
   * @param {object} state - Game state
   * @param {function} getCellValue - (idx) => number | undefined
   * @returns {boolean} true if complete and valid
   */
  isComplete(state, getCellValue) {
    const N = state.size;
    const total = N * N;
    for (let i = 0; i < total; i++) {
      if (!getCellValue(i)) return false;
    }
    return this.findAllConflicts(state, getCellValue).size === 0;
  },

  // ── Visual layer helpers ──────────────────────────────

  /**
   * Get cells to highlight for Hyper (Windoku) variant.
   * @param {object} state - Game state
   * @returns {number[]} cell indices in the 4 hyper windows
   */
  getHyperHighlightCells(state) {
    if (state.size !== 9) return [];
    const windows = [[1, 1], [1, 5], [5, 1], [5, 5]];
    const cells = [];
    for (const [sr, sc] of windows) {
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
          cells.push((sr + r) * 9 + (sc + c));
    }
    return cells;
  },

  /**
   * Get diagonal cells for highlighting.
   * @param {number} N - board size
   * @returns {object} { main: number[], anti: number[] }
   */
  getDiagonalCells(N) {
    const main = [], anti = [];
    for (let i = 0; i < N; i++) {
      main.push(i * N + i);
      anti.push(i * N + (N - 1 - i));
    }
    return { main, anti };
  },

  /**
   * Render Killer cage SVG overlay.
   * Uses <line> elements for borders with cage-specific colors,
   * and <text> for sum labels in the top-left cell of each cage.
   */
  renderKillerSVG(svg, cages, N, cw, ch, cssVar) {
    const cellToCage = new Array(N * N).fill(-1);
    const cageColor = [];
    cages.forEach((c, ci) => {
      c.cells.forEach(idx => cellToCage[idx] = ci);
      cageColor[ci] = SZ.Constraints.getCageColor(ci);
    });

    // Draw cage sum labels
    cages.forEach((c, ci) => {
      const first = Math.min(...c.cells);
      const r = Math.floor(first / N), col = first % N;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', col * cw + 3);
      label.setAttribute('y', r * ch + 11);
      label.setAttribute('font-size', Math.max(8, cw * 0.18));
      label.setAttribute('font-weight', '700');
      label.setAttribute('fill', cageColor[ci]);
      label.setAttribute('font-family', 'DM Sans, sans-serif');
      label.setAttribute('pointer-events', 'none');
      label.textContent = c.sum;
      svg.appendChild(label);
    });

    // Draw cage borders
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const idx = r * N + c;
        const ci = cellToCage[idx];
        if (ci < 0) continue;
        // Right border
        if (c < N - 1 && cellToCage[idx + 1] !== ci) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', (c + 1) * cw);
          line.setAttribute('y1', r * ch);
          line.setAttribute('x2', (c + 1) * cw);
          line.setAttribute('y2', (r + 1) * ch);
          line.setAttribute('stroke', cageColor[ci] || cssVar('--box-border'));
          line.setAttribute('stroke-width', '2.5');
          svg.appendChild(line);
        }
        // Bottom border
        if (r < N - 1 && cellToCage[idx + N] !== ci) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', c * cw);
          line.setAttribute('y1', (r + 1) * ch);
          line.setAttribute('x2', (c + 1) * cw);
          line.setAttribute('y2', (r + 1) * ch);
          line.setAttribute('stroke', cageColor[ci] || cssVar('--box-border'));
          line.setAttribute('stroke-width', '2.5');
          svg.appendChild(line);
        }
      }
    }
    // Outer border
    const borderColor = cssVar('--box-border') || '#555';
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0'); rect.setAttribute('y', '0');
    rect.setAttribute('width', N * cw); rect.setAttribute('height', N * ch);
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', borderColor);
    rect.setAttribute('stroke-width', '3');
    svg.appendChild(rect);
  },

  /**
   * Render Thermo SVG overlay.
   * Bulb = filled circle, tube = <line> segments with rounded caps.
   */
  renderThermoSVG(svg, thermos, N, cw, ch, cssVar) {
    const accent = cssVar('--accent');
    thermos.forEach(thermo => {
      const cells = thermo.cells;
      if (cells.length < 2) return;

      const points = cells.map(idx => {
        const r = Math.floor(idx / N), c = idx % N;
        return { x: c * cw + cw / 2, y: r * ch + ch / 2 };
      });

      // Tube lines
      for (let i = 0; i < points.length - 1; i++) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', points[i].x);
        line.setAttribute('y1', points[i].y);
        line.setAttribute('x2', points[i + 1].x);
        line.setAttribute('y2', points[i + 1].y);
        line.setAttribute('stroke', accent);
        line.setAttribute('stroke-width', '3');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('opacity', '0.45');
        svg.appendChild(line);
      }

      // Bulb (first cell)
      const bulb = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      bulb.setAttribute('cx', points[0].x);
      bulb.setAttribute('cy', points[0].y);
      bulb.setAttribute('r', cw * 0.35);
      bulb.setAttribute('fill', accent);
      bulb.setAttribute('opacity', '0.18');
      svg.appendChild(bulb);

      // Tip marker (last cell)
      const last = points[points.length - 1];
      const tip = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      tip.setAttribute('cx', last.x);
      tip.setAttribute('cy', last.y);
      tip.setAttribute('r', cw * 0.30);
      tip.setAttribute('fill', 'none');
      tip.setAttribute('stroke', accent);
      tip.setAttribute('stroke-width', '2');
      tip.setAttribute('opacity', '0.5');
      svg.appendChild(tip);
    });
  },

  /**
   * Render Arrow SVG overlay.
   * Circle = <circle> around circle cell, path = <polyline> with arrowhead marker.
   */
  renderArrowSVG(svg, arrows, N, cw, ch, cssVar) {
    const accent2 = cssVar('--accent2');

    // Build arrowhead marker definition
    let defs = svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.appendChild(defs);
    }
    let marker = defs.querySelector('#arrowhead');
    if (!marker) {
      marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', 'arrowhead');
      marker.setAttribute('markerWidth', '8');
      marker.setAttribute('markerHeight', '6');
      marker.setAttribute('refX', '8');
      marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');
      marker.setAttribute('markerUnits', 'userSpaceOnUse');
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', '0 0, 8 3, 0 6');
      poly.setAttribute('fill', accent2);
      poly.setAttribute('opacity', '0.6');
      marker.appendChild(poly);
      defs.appendChild(marker);
    }

    arrows.forEach(arrow => {
      const circleIdx = arrow.circle;
      const path = arrow.path;
      if (path.length < 1) return;

      const cr = Math.floor(circleIdx / N), cc = circleIdx % N;
      const cx = cc * cw + cw / 2, cy = cr * ch + ch / 2;

      // Build polyline points: circle center → path cells
      const pts = `${cx},${cy}`;
      const pathPts = path.map(pi => {
        const r = Math.floor(pi / N), c = pi % N;
        return `${c * cw + cw / 2},${r * ch + ch / 2}`;
      });

      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', pts + ' ' + pathPts.join(' '));
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('stroke', accent2);
      polyline.setAttribute('stroke-width', '2.5');
      polyline.setAttribute('stroke-linecap', 'round');
      polyline.setAttribute('stroke-linejoin', 'round');
      polyline.setAttribute('opacity', '0.5');
      polyline.setAttribute('marker-end', 'url(#arrowhead)');
      svg.appendChild(polyline);

      // Circle cell marker
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', cy);
      circle.setAttribute('r', cw * 0.38);
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', accent2);
      circle.setAttribute('stroke-width', '2.5');
      circle.setAttribute('opacity', '0.5');
      svg.appendChild(circle);
    });
  }
};

/* ═══════════════════════════════════════════════════════
   VARIANT ENGINE — JIGSAW BORDER RENDERING (SVG)
   Renders irregular region boundaries as SVG <path>
   elements instead of per-cell border hacks.
   ═══════════════════════════════════════════════════════ */

/**
 * Build SVG path data for Jigsaw region borders.
 * Scans cell boundaries; where two adjacent cells belong to different
 * regions (or edge of board), draws a segment.
 * @param {number[]} regionMap - 81-element array
 * @param {number} N - board size (usually 9)
 * @param {number} cw - cell width in SVG units
 * @param {number} ch - cell height in SVG units
 * @returns {string} SVG path `d` attribute
 */
function buildJigsawBorderPath(regionMap, N, cw, ch) {
  const segments = [];

  // Vertical borders
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const idx = r * N + c;
      const myRegion = regionMap[idx];
      // Right edge of board
      if (c === N - 1) {
        segments.push(`M${(c + 1) * cw},${r * ch} L${(c + 1) * cw},${(r + 1) * ch}`);
      } else if (regionMap[idx + 1] !== myRegion) {
        segments.push(`M${(c + 1) * cw},${r * ch} L${(c + 1) * cw},${(r + 1) * ch}`);
      }
      // Bottom edge of board
      if (r === N - 1) {
        segments.push(`M${c * cw},${(r + 1) * ch} L${(c + 1) * cw},${(r + 1) * ch}`);
      } else if (regionMap[idx + N] !== myRegion) {
        segments.push(`M${c * cw},${(r + 1) * ch} L${(c + 1) * cw},${(r + 1) * ch}`);
      }
    }
  }

  return segments.join(' ');
}

/**
 * Render Jigsaw region borders as SVG <path> overlaid on the board.
 * Replaces the per-cell border-right/border-bottom approach.
 */
function renderJigsawSVG(svg, regionMap, N, cw, ch, cssVar) {
  const d = buildJigsawBorderPath(regionMap, N, cw, ch);
  if (!d) return;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('stroke', cssVar('--jigsaw-stroke') || cssVar('--box-border'));
  path.setAttribute('stroke-width', '2.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
}
