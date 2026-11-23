/**
 * MAPA DE SEGUIMIENTO DE MATERIAS Y NOTAS
 * Profesorado de Ciencias Biológicas · FaHCE · UNLP (Plan 2003)
 * Solo seguimiento de materias, notas y correlatividades (sin descarga de materiales)
 */

document.addEventListener('DOMContentLoaded', () => {
  const data = window.ACADEMIC_DATA;
  const electivesCatalog = window.ELECTIVES_CATALOG || {};
  if (!data || !data.materias) {
    console.error('No se pudieron cargar los datos curriculares.');
    return;
  }

  // Storage Keys
  const STORAGE_KEY = 'unlp_biologia_status_overrides_v1';
  const ELECTIVES_KEY = 'unlp_biologia_selected_electives_v1';
  const PLACEMENT_KEY = 'unlp_biologia_cuat_placement_v1';

  // DOM Elements
  const matrixContainer = document.getElementById('matrixContainer');
  const connectionsSvg = document.getElementById('connectionsSvg');
  const mapViewport = document.getElementById('mapViewport');

  // HUD Elements
  const hudGpa = document.getElementById('hudGpa');
  const hudAvance = document.getElementById('hudAvance');
  const hudMateriasRatio = document.getElementById('hudMateriasRatio');

  // Subject Tracking Modal Elements
  const subjectDrawer = document.getElementById('subjectDrawer');
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');
  const drawerCode = document.getElementById('drawerCode');
  const drawerTitle = document.getElementById('drawerTitle');
  const drawerYearRegimen = document.getElementById('drawerYearRegimen');
  const drawerFaculty = document.getElementById('drawerFaculty');
  const drawerStatusSubtitle = document.getElementById('drawerStatusSubtitle');
  const btnDrawerChangeElective = document.getElementById('btnDrawerChangeElective');
  const drawerStatusSelect = document.getElementById('drawerStatusSelect');
  const drawerGradeEditor = document.getElementById('drawerGradeEditor');
  const drawerGradeInput = document.getElementById('drawerGradeInput');
  const drawerDateInput = document.getElementById('drawerDateInput');
  const drawerSavedIndicator = document.getElementById('drawerSavedIndicator');
  const drawerRegimenDesc = document.getElementById('drawerRegimenDesc');
  const drawerFacultyDesc = document.getElementById('drawerFacultyDesc');
  const drawerCorrCursar = document.getElementById('drawerCorrCursar');
  const drawerCorrRendir = document.getElementById('drawerCorrRendir');
  const badgeCanCursar = document.getElementById('badgeCanCursar');
  const badgeCanRendir = document.getElementById('badgeCanRendir');
  const drawerUnlocksCount = document.getElementById('drawerUnlocksCount');
  const drawerUnlocksList = document.getElementById('drawerUnlocksList');
  const drawerNotesInput = document.getElementById('drawerNotesInput');

  // Electives Modal Elements
  const electivesModal = document.getElementById('electivesModal');
  const electivesModalCloseBtn = document.getElementById('electivesModalCloseBtn');
  const electivesModalSlotMeta = document.getElementById('electivesModalSlotMeta');
  const electivesModalTitle = document.getElementById('electivesModalTitle');
  const electivesModalSubtitle = document.getElementById('electivesModalSubtitle');
  const electivesListContainer = document.getElementById('electivesListContainer');
  const btnClearElective = document.getElementById('btnClearElective');

  // Mobile Action Pill Elements
  const mobileActionPill = document.getElementById('mobileActionPill');
  const mobilePillCode = document.getElementById('mobilePillCode');
  const mobilePillName = document.getElementById('mobilePillName');
  const mobilePillBtn = document.getElementById('mobilePillBtn');
  const mobilePillClose = document.getElementById('mobilePillClose');

  // Toast
  const toastNotice = document.getElementById('toastNotice');

  // State
  let currentDrawerCode = null;
  let currentModalSlotCode = null;
  let activeStateFilter = null;
  let mobileActiveCode = null;
  let activeAnimationId = null;
  let currentActiveEdges = [];

  // =========================================================================
  // 1. GRAPH BUILDING (Prereqs, Unlocks, Transitive Ancestors & Descendants)
  // =========================================================================
  const subjectMap = new Map();

  function buildCurriculumGraph() {
    subjectMap.clear();

    // 1. Register nodes & direct prereqs (union of cursar and rendir)
    data.materias.forEach(m => {
      const prereqSet = new Set();
      (m.correlativas_cursar || []).forEach(req => {
        if (req && req.code) prereqSet.add(req.code);
      });
      (m.correlativas_rendir || []).forEach(c => {
        if (c) prereqSet.add(c);
      });
      m.prereq_codes = Array.from(prereqSet);
      m.unlocks_codes = [];
      m.all_ancestors = [];
      m.all_descendants = [];
      subjectMap.set(m.code, m);
    });

    // 2. Direct unlocks (reverse edges)
    data.materias.forEach(m => {
      m.prereq_codes.forEach(pCode => {
        const p = subjectMap.get(pCode);
        if (p && !p.unlocks_codes.includes(m.code)) {
          p.unlocks_codes.push(m.code);
        }
      });
    });

    // 3. Transitive closure (all_ancestors & all_descendants)
    const getAncestors = (code, visited = new Set()) => {
      const m = subjectMap.get(code);
      if (!m) return visited;
      for (const p of m.prereq_codes) {
        if (!visited.has(p)) {
          visited.add(p);
          getAncestors(p, visited);
        }
      }
      return visited;
    };

    const getDescendants = (code, visited = new Set()) => {
      const m = subjectMap.get(code);
      if (!m) return visited;
      for (const u of m.unlocks_codes) {
        if (!visited.has(u)) {
          visited.add(u);
          getDescendants(u, visited);
        }
      }
      return visited;
    };

    data.materias.forEach(m => {
      m.all_ancestors = Array.from(getAncestors(m.code));
      m.all_descendants = Array.from(getDescendants(m.code));
    });
  }

  buildCurriculumGraph();

  // =========================================================================
  // 2. LOCALSTORAGE PERSISTENCE & ELECTIVES RESOLUTION
  // =========================================================================

  function getStoredOverrides() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveStoredOverrides(overrides) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch (e) {
      console.error('Error guardando estado local:', e);
    }
  }

  function getSelectedElectives() {
    try {
      const raw = localStorage.getItem(ELECTIVES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveSelectedElectives(selections) {
    try {
      localStorage.setItem(ELECTIVES_KEY, JSON.stringify(selections));
    } catch (e) {}
  }

  function findElectiveInCatalog(code, slotType) {
    if (!code) return null;
    if (slotType && electivesCatalog[slotType]) {
      const match = electivesCatalog[slotType].find(item => item.code === code);
      if (match) return match;
    }
    for (const list of Object.values(electivesCatalog)) {
      const match = list.find(item => item.code === code);
      if (match) return match;
    }
    return null;
  }

  function getAssignedElective(m) {
    if (!m || !m.is_elective_slot) return null;
    const selections = getSelectedElectives();
    const assignedCode = selections[m.code];
    return assignedCode ? findElectiveInCatalog(assignedCode, m.slot_type) : null;
  }

  function getEffectiveRecord(m) {
    const overrides = getStoredOverrides();
    if (m.is_elective_slot) {
      const chosen = getAssignedElective(m);
      if (chosen) {
        const o = overrides[chosen.code] || overrides[m.code] || {};
        return {
          storageCode: chosen.code,
          displayCode: chosen.code,
          displayName: chosen.name,
          regimen: chosen.regimen,
          regimen_desc: chosen.regimen_desc,
          facultad: chosen.facultad,
          facultad_desc: chosen.facultad_desc,
          status: o.status || 'pendiente',
          grade: o.grade !== undefined ? o.grade : null,
          has_failed: !!o.has_failed,
          date: o.date || '',
          notes: o.notes || ''
        };
      }
      return {
        storageCode: m.code,
        displayCode: m.code,
        displayName: m.name,
        regimen: m.regimen,
        regimen_desc: m.regimen_desc,
        facultad: m.facultad,
        facultad_desc: m.facultad_desc,
        status: 'pendiente',
        grade: null,
        has_failed: false,
        date: '',
        notes: ''
      };
    }

    const o = overrides[m.code] || {};
    return {
      storageCode: m.code,
      displayCode: m.code,
      displayName: m.name,
      regimen: m.regimen,
      regimen_desc: m.regimen_desc,
      facultad: m.facultad,
      facultad_desc: m.facultad_desc,
      status: o.status || m.status || 'pendiente',
      grade: o.grade !== undefined ? o.grade : m.grade,
      has_failed: o.has_failed !== undefined ? !!o.has_failed : !!m.has_failed,
      date: o.date !== undefined ? o.date : (m.date || ''),
      notes: o.notes !== undefined ? o.notes : (m.notes || '')
    };
  }

  function applyStoredOverrides() {
    data.materias.forEach(m => {
      const eff = getEffectiveRecord(m);
      m.status = eff.status;
      m.grade = eff.grade;
      m.has_failed = eff.has_failed;
      m.date = eff.date;
      m.notes = eff.notes;
    });
    recalculateStats();
  }

  function persistSubjectState(storageCode, payload) {
    const overrides = getStoredOverrides();
    overrides[storageCode] = {
      status: payload.status,
      grade: payload.grade,
      has_failed: !!payload.has_failed,
      date: payload.date || '',
      notes: payload.notes || ''
    };
    saveStoredOverrides(overrides);
  }

  // =========================================================================
  // 3. ELIGIBILITY CHECKS (Correlativas para Cursar & Rendir Final)
  // =========================================================================

  function isRequirementMet(reqCode, reqType) {
    const prereq = subjectMap.get(reqCode);
    if (!prereq) return false;
    if (reqType === 'F') {
      return prereq.status === 'aprobada';
    }
    // 'C' = cursada aprobada (regular) o final aprobado
    return prereq.status === 'aprobada' || prereq.status === 'cursada_aprobada';
  }

  function canCursarSubject(m) {
    const reqs = m.correlativas_cursar || [];
    if (reqs.length === 0) return true;
    return reqs.every(r => isRequirementMet(r.code, r.type));
  }

  function canRendirSubject(m) {
    const reqs = m.correlativas_rendir || [];
    if (reqs.length === 0) return true;
    return reqs.every(code => isRequirementMet(code, 'F'));
  }

  // =========================================================================
  // 4. STATS & HUD TELEMETRY
  // =========================================================================

  function recalculateStats() {
    let approved = 0;
    let inCourse = 0;
    let cursada = 0;
    let pending = 0;
    let failed = 0;
    let gradeSum = 0;
    let gradedCount = 0;

    data.materias.forEach(m => {
      if (m.status === 'aprobada') {
        approved++;
        if (typeof m.grade === 'number' && !isNaN(m.grade) && m.grade > 0) {
          gradeSum += m.grade;
          gradedCount++;
        }
      } else if (m.status === 'en_curso') {
        inCourse++;
      } else if (m.status === 'cursada_aprobada') {
        cursada++;
      } else {
        pending++;
      }
      if (m.has_failed) failed++;
    });

    data.stats.total = data.materias.length;
    data.stats.aprobadas = approved;
    data.stats.cursada_aprobada = cursada;
    data.stats.en_curso = inCourse;
    data.stats.pendientes = pending;
    data.stats.reprobadas_previas = failed;
    data.promedio = gradedCount > 0 ? Number((gradeSum / gradedCount).toFixed(2)) : 0.0;

    updateHud();
  }

  function updateHud() {
    const formattedGpa = Number(data.promedio).toFixed(2);
    if (hudGpa) hudGpa.textContent = formattedGpa;
    const sideGpa = document.getElementById('sideGpa');
    if (sideGpa) sideGpa.textContent = formattedGpa;

    const approved = data.stats.aprobadas;
    const total = data.stats.total;
    const percent = total > 0 ? ((approved / total) * 100).toFixed(1) : '0.0';

    if (hudAvance) hudAvance.textContent = `${percent}%`;
    if (hudMateriasRatio) hudMateriasRatio.textContent = `(${approved}/${total})`;
    const sideAvance = document.getElementById('sideAvance');
    if (sideAvance) sideAvance.textContent = `${percent}%`;
    const sideMateriasRatio = document.getElementById('sideMateriasRatio');
    if (sideMateriasRatio) sideMateriasRatio.textContent = `(${approved}/${total})`;

    const counters = [
      ['chipAprobadas', 'chipSideAprobadas', data.stats.aprobadas],
      ['chipEnCurso', 'chipSideEnCurso', data.stats.en_curso],
      ['chipCursada', 'chipSideCursada', data.stats.cursada_aprobada],
      ['chipPendientes', 'chipSidePendientes', data.stats.pendientes],
      ['chipRecursa', 'chipSideRecursa', data.stats.reprobadas_previas]
    ];

    counters.forEach(([id1, id2, val]) => {
      const el1 = document.getElementById(id1);
      const el2 = document.getElementById(id2);
      if (el1) el1.textContent = val;
      if (el2) el2.textContent = val;
    });
  }

  // =========================================================================
  // 5. MATRIX RENDERING (5 Años + Idiomas)
  // =========================================================================

  // Según el Plan de Estudios 2003-6 de Guaraní, TODAS las materias cuatrimestrales (años 1..5)
  // figuran como "ambos cuatrimestres", así que se pueden arrastrar entre 1º y 2º cuatrimestre.
  function isFlexibleCuat(m) {
    if (!m || m.col_num === 6) return false; // Idiomas va en columna aparte
    const reg = String(getEffectiveRecord(m).regimen || '').trim();
    if (/^A\b/.test(reg) || /^anual/i.test(reg)) return false;
    return true;
  }

  function getPlacementOverrides() {
    try {
      return JSON.parse(localStorage.getItem(PLACEMENT_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function savePlacementOverride(code, cuat) {
    const p = getPlacementOverrides();
    p[code] = cuat;
    localStorage.setItem(PLACEMENT_KEY, JSON.stringify(p));
  }

  // Devuelve 'anual', '1' o '2' según el régimen efectivo (considera la optativa elegida)
  function getPlacement(m) {
    const eff = getEffectiveRecord(m);
    const reg = String(eff.regimen || '').trim();
    if (/^A\b/.test(reg) || /^anual/i.test(reg)) return 'anual';
    if (isFlexibleCuat(m)) {
      const saved = getPlacementOverrides()[m.code];
      if (saved === '1' || saved === '2') return saved;
    }
    const match = reg.match(/\((\d)\)/);
    if (match && match[1] === '2') return '2';
    return '1'; // C (1), C (3) (ambos cuatrimestres) o sin dato -> 1º cuatrimestre
  }

  function makeNode(m) {
    const node = createNodeElement(m);
    if (isFlexibleCuat(m)) {
      node.draggable = true;
      node.classList.add('is-draggable');
      node.dataset.year = m.col_num;
      node.title = 'Arrastrá para cambiar de cuatrimestre';
      const top = node.querySelector('.node-top');
      if (top) top.insertAdjacentHTML('afterbegin', `<span class="drag-handle" aria-hidden="true">⠿</span>`);
    }
    return node;
  }

  function getRegimenLabel(regimen) {
    const reg = String(regimen || '').trim();
    if (/^A\b/.test(reg) || /^anual/i.test(reg)) return { text: 'Anual', cls: 'is-anual' };
    const match = reg.match(/\((\d)\)/);
    if (match && match[1] === '3') return { text: '1º y 2º C', cls: 'is-ambos' };
    if (match) return { text: `${match[1]}º Cuat.`, cls: '' };
    return { text: 'Cuatrimestral', cls: '' };
  }

  function renderMatrix() {
    matrixContainer.innerHTML = '';

    // Años 1..5: bloque con Anuales arriba + 1º / 2º cuatrimestre abajo
    for (let year = 1; year <= 5; year++) {
      const subs = data.materias.filter(m => (m.col_num || 1) === year);
      const groups = { anual: [], '1': [], '2': [] };
      subs.forEach(m => groups[getPlacement(m)].push(m));

      const block = document.createElement('div');
      block.className = 'year-block';
      block.dataset.year = year;

      if (groups.anual.length > 0) {
        const annual = document.createElement('div');
        annual.className = 'annual-section';
        annual.innerHTML = `<span class="section-tag">Anuales</span>`;
        groups.anual.forEach(m => annual.appendChild(makeNode(m)));
        block.appendChild(annual);
      }

      const cuatSection = document.createElement('div');
      cuatSection.className = 'cuat-section';
      ['1', '2'].forEach(c => {
        const col = document.createElement('div');
        col.className = 'cuat-column';
        col.dataset.cuat = c;
        col.dataset.year = year;
        if (groups[c].length === 0) {
          col.innerHTML = `<div class="cuat-empty">—</div>`;
        } else {
          groups[c].forEach(m => col.appendChild(makeNode(m)));
        }
        cuatSection.appendChild(col);
      });
      block.appendChild(cuatSection);

      matrixContainer.appendChild(block);
    }

    // Columna de Idiomas
    const idiomasCol = document.createElement('div');
    idiomasCol.className = 'sem-column col-idiomas-column';
    data.materias.filter(m => m.col_num === 6).forEach(m => idiomasCol.appendChild(createNodeElement(m)));
    matrixContainer.appendChild(idiomasCol);

    attachNodeEvents();
    if (activeStateFilter) {
      updateNodesFilterState(activeStateFilter);
    }
  }

  function createNodeElement(m) {
    const node = document.createElement('div');
    const eff = getEffectiveRecord(m);
    const chosenElective = m.is_elective_slot ? getAssignedElective(m) : null;

    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.dataset.code = m.code;

    // Unassigned Elective or Idioma slot
    if (m.is_elective_slot && !chosenElective) {
      node.className = 'subject-node node-optativa-slot is-unassigned';
      node.dataset.isElectiveSlot = 'true';
      node.dataset.status = 'pendiente';
      node.dataset.failed = 'false';

      const eligible = canCursarSubject(m);
      const eligHTML = eligible ? `<span class="node-elig-badge" title="Cumplís las correlativas para cursarla">Habilitada</span>` : '';

      node.innerHTML = `
        <div class="node-top">
          <span class="node-code">${m.code}</span>
          <span class="node-grade-tag grade-optativa-choose">+ ELEGIR</span>
        </div>
        <div class="node-name" title="${m.name}">${m.name}</div>
        <div class="node-bottom">
          <span class="optativa-type-hint">${m.slot_hint || 'A elección'}</span>
          ${eligHTML}
        </div>
        <div class="node-expanded-info">
          <div><strong>${m.year}</strong> · ${m.regimen}</div>
          <div>Clic para elegir la materia de este espacio</div>
        </div>
      `;
      return node;
    }

    // Regular subject or assigned Elective/Idioma
    node.className = m.is_elective_slot ? 'subject-node node-optativa-slot is-assigned' : 'subject-node';
    if (m.is_elective_slot) node.dataset.isElectiveSlot = 'true';
    node.dataset.status = eff.status;
    node.dataset.failed = eff.has_failed ? 'true' : 'false';

    let gradeTagHTML = '';
    if (eff.status === 'aprobada') {
      const label = (eff.grade !== null && eff.grade !== undefined && !isNaN(eff.grade)) ? eff.grade : '✓';
      gradeTagHTML = `<span class="node-grade-tag grade-aprobada">${label}</span>`;
    } else if (eff.status === 'en_curso') {
      gradeTagHTML = `<span class="node-grade-tag grade-en-curso">EN CURSO</span>`;
    } else if (eff.status === 'cursada_aprobada') {
      gradeTagHTML = `<span class="node-grade-tag grade-cursada">REG</span>`;
    }

    const regInfo = getRegimenLabel(eff.regimen);

    const showEligible = eff.status === 'pendiente' && !eff.has_failed && canCursarSubject(m);
    const rightBottomHTML = eff.notes
      ? `<span class="node-note-dot" title="Tiene notas personales">🗒️</span>`
      : (showEligible ? `<span class="node-elig-badge" title="Cumplís todas las correlativas para cursarla">Habilitada</span>` : `<span>${eff.date || ''}</span>`);

    const displayName = m.is_elective_slot ? `${m.slot_hint}: ${eff.displayName}` : eff.displayName;

    node.innerHTML = `
      <div class="node-top">
        <span class="node-code">${eff.displayCode}</span>
        ${gradeTagHTML}
      </div>
      <div class="node-name" title="${displayName}">${displayName}</div>
      <div class="node-bottom">
        <span class="node-regimen-pill ${regInfo.cls}">${regInfo.text}</span>
        ${rightBottomHTML}
      </div>
      <div class="node-expanded-info">
        <div><strong>${m.year}</strong> · ${eff.facultad}</div>
        <div>${formatConditionText(eff)}</div>
      </div>
    `;

    return node;
  }

  function formatConditionText(rec) {
    if (rec.status === 'aprobada') {
      const g = (rec.grade !== null && rec.grade !== undefined && !isNaN(rec.grade)) ? `${rec.grade} pts` : 'Sin nota cargada';
      return `Aprobada (${g})${rec.date ? ' · ' + rec.date : ''}`;
    }
    if (rec.status === 'en_curso') {
      return `Cursando actualmente${rec.date ? ' (' + rec.date + ')' : ''}`;
    }
    if (rec.status === 'cursada_aprobada') {
      return `Cursada aprobada (debe final)${rec.date ? ' · ' + rec.date : ''}`;
    }
    return rec.has_failed ? 'Pendiente (debe recursar)' : 'Pendiente de cursar';
  }

  // =========================================================================
  // 6. HOVER & TRANSITIVE PATH TRACING + SVG WIRES
  // =========================================================================

  function attachNodeEvents() {
    const nodes = document.querySelectorAll('.subject-node');

    nodes.forEach(node => {
      node.addEventListener('mouseenter', () => {
        if (window.matchMedia('(max-width: 768px)').matches) return;
        const code = node.dataset.code;
        if (code) highlightFullChain(code, node);
      });

      node.addEventListener('mouseleave', () => {
        if (window.matchMedia('(max-width: 768px)').matches) return;
        clearFullChain();
      });

      node.addEventListener('focus', () => {
        const code = node.dataset.code;
        if (code) highlightFullChain(code, node);
      });

      node.addEventListener('blur', () => {
        if (window.matchMedia('(max-width: 768px)').matches) return;
        clearFullChain();
      });

      node.addEventListener('click', () => {
        const isTouch = window.matchMedia('(max-width: 768px)').matches || ('ontouchstart' in window && window.innerWidth <= 1024);
        const code = node.dataset.code;
        const m = subjectMap.get(code);
        if (!m) return;

        if (m.is_elective_slot && !getAssignedElective(m)) {
          hideMobilePill();
          openElectivesModal(code);
          return;
        }

        if (isTouch) {
          if (mobileActiveCode === code) {
            hideMobilePill();
            openDrawer(code);
          } else {
            clearFullChain();
            mobileActiveCode = code;
            highlightFullChain(code, node);
            showMobilePill(code);
          }
        } else {
          openDrawer(code);
        }
      });

      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const code = node.dataset.code;
          const m = subjectMap.get(code);
          if (!m) return;
          if (m.is_elective_slot && !getAssignedElective(m)) {
            openElectivesModal(code);
          } else {
            openDrawer(code);
          }
        }
      });
    });
  }

  function highlightFullChain(code, hoveredNode) {
    const target = subjectMap.get(code);
    if (!target) return;

    if (activeAnimationId) {
      cancelAnimationFrame(activeAnimationId);
      activeAnimationId = null;
    }

    document.querySelectorAll('.subject-node').forEach(node => {
      node.classList.remove('is-hovered', 'is-ancestor', 'is-descendant');
      if (activeStateFilter) {
        node.classList.remove('is-filter-highlighted', 'is-filter-dimmed');
      }
    });

    matrixContainer.classList.add('has-active-path');
    hoveredNode.classList.add('is-hovered');

    const ancestors = new Set(target.all_ancestors || []);
    const descendants = new Set(target.all_descendants || []);

    const nodeElemMap = new Map();
    document.querySelectorAll('.subject-node').forEach(n => {
      const c = n.dataset.code;
      if (c) nodeElemMap.set(c, n);
      if (ancestors.has(c)) n.classList.add('is-ancestor');
      else if (descendants.has(c)) n.classList.add('is-descendant');
    });

    currentActiveEdges = computeReducedEdges(code, ancestors, descendants);
    setupWireElements(currentActiveEdges);
    renderWires(currentActiveEdges, nodeElemMap);

    const startTime = performance.now();
    function step(now) {
      if (!matrixContainer.classList.contains('has-active-path')) return;
      renderWires(currentActiveEdges, nodeElemMap);
      if (now - startTime < 320) {
        activeAnimationId = requestAnimationFrame(step);
      } else {
        activeAnimationId = null;
      }
    }
    activeAnimationId = requestAnimationFrame(step);
  }

  function clearFullChain() {
    if (activeAnimationId) {
      cancelAnimationFrame(activeAnimationId);
      activeAnimationId = null;
    }
    currentActiveEdges = [];
    matrixContainer.classList.remove('has-active-path');

    const defs = connectionsSvg.querySelector('defs');
    connectionsSvg.innerHTML = '';
    if (defs) connectionsSvg.appendChild(defs);

    document.querySelectorAll('.subject-node').forEach(n => {
      n.classList.remove('is-hovered', 'is-ancestor', 'is-descendant');
    });

    if (activeStateFilter) {
      updateNodesFilterState(activeStateFilter);
    }
  }

  function isTransitiveRedundant(uCode, vCode, activeNodes) {
    const uObj = subjectMap.get(uCode);
    if (!uObj) return false;
    const uDescendants = new Set(uObj.all_descendants || []);

    for (const wCode of activeNodes) {
      if (wCode !== uCode && wCode !== vCode && uDescendants.has(wCode)) {
        const wObj = subjectMap.get(wCode);
        if (wObj && (wObj.all_descendants || []).includes(vCode)) {
          return true;
        }
      }
    }
    return false;
  }

  function computeReducedEdges(targetCode, ancestors, descendants) {
    const edges = [];
    const drawnKeys = new Set();
    const activeNodes = new Set([targetCode, ...ancestors, ...descendants]);

    const ancestorNodes = new Set([targetCode, ...ancestors]);
    ancestorNodes.forEach(vCode => {
      const vObj = subjectMap.get(vCode);
      if (!vObj) return;
      (vObj.prereq_codes || []).forEach(uCode => {
        if (ancestorNodes.has(uCode) && !isTransitiveRedundant(uCode, vCode, activeNodes)) {
          const key = `${uCode}->${vCode}`;
          if (!drawnKeys.has(key)) {
            drawnKeys.add(key);
            edges.push({
              uCode,
              vCode,
              cssClass: `wire-ancestor${vCode === targetCode ? '' : ' wire-indirect'}`,
              markerId: 'arrow-anc'
            });
          }
        }
      });
    });

    const descendantNodes = new Set([targetCode, ...descendants]);
    descendantNodes.forEach(uCode => {
      const uObj = subjectMap.get(uCode);
      if (!uObj) return;
      (uObj.unlocks_codes || []).forEach(vCode => {
        if (descendantNodes.has(vCode) && !isTransitiveRedundant(uCode, vCode, activeNodes)) {
          const key = `${uCode}->${vCode}`;
          if (!drawnKeys.has(key)) {
            drawnKeys.add(key);
            edges.push({
              uCode,
              vCode,
              cssClass: `wire-descendant${uCode === targetCode ? '' : ' wire-indirect'}`,
              markerId: 'arrow-desc'
            });
          }
        }
      });
    });

    return edges;
  }

  function setupWireElements(edges) {
    const defs = connectionsSvg.querySelector('defs');
    connectionsSvg.innerHTML = '';
    if (defs) connectionsSvg.appendChild(defs);

    edges.forEach((edge, i) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', `svg-wire ${edge.cssClass}`);
      if (edge.markerId) path.setAttribute('marker-end', `url(#${edge.markerId})`);
      path.id = `wire-${i}`;
      connectionsSvg.appendChild(path);
      edge.pathElem = path;
    });
  }

  function renderWires(edges, nodeElemMap) {
    const svgRect = connectionsSvg.getBoundingClientRect();
    if (!svgRect.width || !svgRect.height) return;

    // Calcular geometría y agrupar salidas/llegadas horizontales para repartir puntos en los bordes
    const rectCache = new Map();
    const getRect = (code) => {
      if (!rectCache.has(code)) {
        const el = nodeElemMap.get(code);
        if (el) rectCache.set(code, el.getBoundingClientRect());
      }
      return rectCache.get(code);
    };

    const outGroups = new Map();
    const inGroups = new Map();

    edges.forEach(edge => {
      const uRect = getRect(edge.uCode);
      const vRect = getRect(edge.vCode);
      if (!uRect || !vRect) return;
      const overlapsH = vRect.left < uRect.right - 12 && uRect.left < vRect.right - 12;
      edge._overlapsH = overlapsH;
      if (!overlapsH) {
        if (!outGroups.has(edge.uCode)) outGroups.set(edge.uCode, []);
        outGroups.get(edge.uCode).push(edge);
        if (!inGroups.has(edge.vCode)) inGroups.set(edge.vCode, []);
        inGroups.get(edge.vCode).push(edge);
      }
    });

    // Ordenar puertos por coordenada Y del otro extremo para evitar cruces innecesarios
    outGroups.forEach(list => {
      list.sort((a, b) => {
        const ra = getRect(a.vCode), rb = getRect(b.vCode);
        return (ra.top + ra.height / 2) - (rb.top + rb.height / 2);
      });
    });
    inGroups.forEach(list => {
      list.sort((a, b) => {
        const ra = getRect(a.uCode), rb = getRect(b.uCode);
        return (ra.top + ra.height / 2) - (rb.top + rb.height / 2);
      });
    });

    const portOffset = (list, edge, height) => {
      if (!list || list.length <= 1) return height / 2;
      const idx = list.indexOf(edge);
      const pad = Math.min(12, height * 0.22);
      const span = Math.max(4, height - pad * 2);
      return pad + (span * idx) / (list.length - 1);
    };

    edges.forEach(edge => {
      const uRect = getRect(edge.uCode);
      const vRect = getRect(edge.vCode);
      if (!uRect || !vRect || !edge.pathElem) return;

      let d;
      if (edge._overlapsH) {
        const goesDown = uRect.top <= vRect.top;
        const x1 = uRect.left + uRect.width / 2 - svgRect.left;
        const y1 = (goesDown ? uRect.bottom : uRect.top) - svgRect.top;
        const x2 = vRect.left + vRect.width / 2 - svgRect.left;
        const y2 = (goesDown ? vRect.top : vRect.bottom) - svgRect.top;
        const dy = Math.max(12, Math.abs(y2 - y1) * 0.5) * (goesDown ? 1 : -1);
        d = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
      } else {
        const x1 = uRect.right - svgRect.left;
        const y1 = uRect.top + portOffset(outGroups.get(edge.uCode), edge, uRect.height) - svgRect.top;
        const x2 = vRect.left - svgRect.left;
        const y2 = vRect.top + portOffset(inGroups.get(edge.vCode), edge, vRect.height) - svgRect.top;
        const spanX = Math.abs(x2 - x1);
        const dx = Math.max(26, spanX * 0.42);
        // Pequeño arco vertical en saltos largos horizontales para esquivar tarjetas intermedias
        const midArc = (spanX > 260 && Math.abs(y2 - y1) < 35) ? -22 : 0;
        d = `M ${x1} ${y1} C ${x1 + dx} ${y1 + midArc}, ${x2 - dx} ${y2 + midArc}, ${x2} ${y2}`;
      }
      edge.pathElem.setAttribute('d', d);
    });
  }

  window.addEventListener('resize', () => clearFullChain());

  if (mapViewport) {
    mapViewport.addEventListener('scroll', () => {
      if (matrixContainer.classList.contains('has-active-path') && currentActiveEdges.length > 0) {
        const nodeElemMap = new Map();
        document.querySelectorAll('.subject-node').forEach(n => {
          if (n.dataset.code) nodeElemMap.set(n.dataset.code, n);
        });
        renderWires(currentActiveEdges, nodeElemMap);
      }
    }, { passive: true });

    mapViewport.addEventListener('click', (e) => {
      if (!e.target.closest('.subject-node') && !e.target.closest('#mobileActionPill')) {
        if (mobileActiveCode) {
          hideMobilePill();
          clearFullChain();
        }
      }
    });
  }

  // =========================================================================
  // 7. SUBJECT TRACKING MODAL (<dialog id="subjectDrawer">)
  // =========================================================================

  function updateDrawerHeaderStatus(eff) {
    if (!drawerStatusSubtitle) return;
    drawerStatusSubtitle.textContent = formatConditionText(eff);
    drawerStatusSubtitle.dataset.status = eff.status || 'pendiente';
    if (eff.has_failed) drawerStatusSubtitle.dataset.failed = 'true';
    else drawerStatusSubtitle.removeAttribute('data-failed');
  }

  function renderCorrelativasPanels(m) {
    // 1. Para Cursar
    const cursarReqs = m.correlativas_cursar || [];
    const okCursar = canCursarSubject(m);
    if (badgeCanCursar) {
      badgeCanCursar.textContent = okCursar ? '✓ Habilitada' : 'Faltan correlativas';
      badgeCanCursar.className = `eligibility-badge ${okCursar ? 'is-ok' : 'is-missing'}`;
    }

    if (drawerCorrCursar) {
      drawerCorrCursar.innerHTML = '';
      if (cursarReqs.length === 0) {
        drawerCorrCursar.innerHTML = `<div class="corr-empty">Sin correlativas previas para cursar.</div>`;
      } else {
        cursarReqs.forEach(req => {
          const p = subjectMap.get(req.code);
          const met = isRequirementMet(req.code, req.type);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `corr-item-btn ${met ? 'is-met' : ''}`;
          btn.innerHTML = `
            <div class="corr-item-left">
              <span class="corr-check">${met ? '✅' : '⬜'}</span>
              <span class="corr-code">${req.code}</span>
              <span class="corr-name">${p ? p.name : req.code}</span>
            </div>
            <span class="corr-req-tag ${req.type === 'F' ? 'req-f' : 'req-c'}">${req.type === 'F' ? 'Final (F)' : 'Cursada (C)'}</span>
          `;
          btn.addEventListener('click', () => openDrawer(req.code));
          drawerCorrCursar.appendChild(btn);
        });
      }
    }

    // 2. Para Rendir Final
    const rendirReqs = m.correlativas_rendir || [];
    const okRendir = canRendirSubject(m);
    if (badgeCanRendir) {
      badgeCanRendir.textContent = okRendir ? '✓ Habilitada' : 'Faltan finales';
      badgeCanRendir.className = `eligibility-badge ${okRendir ? 'is-ok' : 'is-missing'}`;
    }

    if (drawerCorrRendir) {
      drawerCorrRendir.innerHTML = '';
      if (rendirReqs.length === 0) {
        drawerCorrRendir.innerHTML = `<div class="corr-empty">Sin correlativas previas para rendir final.</div>`;
      } else {
        rendirReqs.forEach(reqCode => {
          const p = subjectMap.get(reqCode);
          const met = isRequirementMet(reqCode, 'F');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `corr-item-btn ${met ? 'is-met' : ''}`;
          btn.innerHTML = `
            <div class="corr-item-left">
              <span class="corr-check">${met ? '✅' : '⬜'}</span>
              <span class="corr-code">${reqCode}</span>
              <span class="corr-name">${p ? p.name : reqCode}</span>
            </div>
            <span class="corr-req-tag req-f">Final (F)</span>
          `;
          btn.addEventListener('click', () => openDrawer(reqCode));
          drawerCorrRendir.appendChild(btn);
        });
      }
    }

    // 3. Materias que habilita
    const unlocks = m.unlocks_codes || [];
    if (drawerUnlocksCount) {
      drawerUnlocksCount.textContent = `${unlocks.length} ${unlocks.length === 1 ? 'materia' : 'materias'}`;
    }
    if (drawerUnlocksList) {
      drawerUnlocksList.innerHTML = '';
      if (unlocks.length === 0) {
        drawerUnlocksList.innerHTML = `<div class="corr-empty">No es correlativa directa de otras materias.</div>`;
      } else {
        unlocks.forEach(uCode => {
          const u = subjectMap.get(uCode);
          if (!u) return;
          const effU = getEffectiveRecord(u);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'unlock-chip-btn';
          btn.innerHTML = `<span class="unlock-chip-code">${effU.displayCode}</span><span>${effU.displayName}</span>`;
          btn.addEventListener('click', () => openDrawer(uCode));
          drawerUnlocksList.appendChild(btn);
        });
      }
    }
  }

  function openDrawer(code) {
    clearFullChain();
    hideMobilePill();
    const m = subjectMap.get(code);
    if (!m) return;

    if (m.is_elective_slot && !getAssignedElective(m)) {
      openElectivesModal(code);
      return;
    }

    currentDrawerCode = code;
    const eff = getEffectiveRecord(m);

    if (btnDrawerChangeElective) {
      if (m.is_elective_slot) {
        btnDrawerChangeElective.style.display = 'inline-flex';
        btnDrawerChangeElective.onclick = () => {
          subjectDrawer.close();
          setTimeout(() => openElectivesModal(m.code), 40);
        };
      } else {
        btnDrawerChangeElective.style.display = 'none';
      }
    }

    drawerCode.textContent = eff.displayCode;
    drawerTitle.textContent = m.is_elective_slot ? `${m.slot_hint}: ${eff.displayName}` : eff.displayName;
    drawerYearRegimen.textContent = `${m.year} · ${eff.regimen}`;
    drawerFaculty.textContent = eff.facultad;
    drawerRegimenDesc.textContent = eff.regimen_desc;
    drawerFacultyDesc.textContent = eff.facultad_desc;

    // Sync select
    if (eff.has_failed && eff.status === 'pendiente') {
      drawerStatusSelect.value = 'recursa';
    } else {
      drawerStatusSelect.value = eff.status;
    }

    // Sync grade input
    if (eff.status === 'aprobada') {
      drawerGradeEditor.style.display = 'flex';
      drawerGradeInput.value = (eff.grade !== null && eff.grade !== undefined && !isNaN(eff.grade)) ? eff.grade : '';
    } else {
      drawerGradeEditor.style.display = 'none';
      drawerGradeInput.value = '';
    }

    // Sync date & personal notes
    drawerDateInput.value = eff.date || '';
    drawerNotesInput.value = eff.notes || '';

    updateDrawerHeaderStatus(eff);
    renderCorrelativasPanels(m);
    if (window.__syncDrawerCuatEditor) window.__syncDrawerCuatEditor(m);

    if (!subjectDrawer.open) {
      subjectDrawer.showModal();
    }
  }

  function saveCurrentDrawerChanges(showFeedbackToast = false, toastMsg = '') {
    if (!currentDrawerCode) return;
    const m = subjectMap.get(currentDrawerCode);
    if (!m) return;

    const eff = getEffectiveRecord(m);
    const selectedVal = drawerStatusSelect.value;

    let status = selectedVal;
    let has_failed = false;
    let grade = eff.grade;

    if (selectedVal === 'recursa') {
      status = 'pendiente';
      has_failed = true;
      grade = null;
      drawerGradeEditor.style.display = 'none';
    } else if (selectedVal === 'aprobada') {
      status = 'aprobada';
      has_failed = false;
      drawerGradeEditor.style.display = 'flex';
      const raw = drawerGradeInput.value.trim();
      const num = parseFloat(raw);
      grade = (!isNaN(num) && num >= 1 && num <= 10) ? parseFloat(num.toFixed(1)) : null;
    } else {
      has_failed = false;
      grade = null;
      drawerGradeEditor.style.display = 'none';
    }

    const date = drawerDateInput.value.trim();
    const notes = drawerNotesInput.value;

    m.status = status;
    m.grade = grade;
    m.has_failed = has_failed;
    m.date = date;
    m.notes = notes;

    persistSubjectState(eff.storageCode, { status, grade, has_failed, date, notes });
    recalculateStats();
    renderMatrix();
    updateDrawerHeaderStatus({ status, grade, has_failed, date });
    renderCorrelativasPanels(m);
    flashSavedIndicator();

    if (showFeedbackToast && toastMsg) {
      showToast(toastMsg);
    }
  }

  drawerStatusSelect.addEventListener('change', () => {
    const m = subjectMap.get(currentDrawerCode);
    if (!m) return;
    const eff = getEffectiveRecord(m);
    const val = drawerStatusSelect.value;
    if (val === 'aprobada') {
      drawerGradeEditor.style.display = 'flex';
      if (!drawerGradeInput.value) drawerGradeInput.focus();
    }
    const labels = {
      aprobada: 'Aprobada / Promocionada',
      cursada_aprobada: 'Cursada Aprobada',
      en_curso: 'En Curso',
      pendiente: 'Pendiente',
      recursa: 'Recursa'
    };
    saveCurrentDrawerChanges(true, `${eff.displayName}: ${labels[val] || val}`);
  });

  drawerGradeInput.addEventListener('input', () => saveCurrentDrawerChanges(false));
  drawerGradeInput.addEventListener('change', () => {
    const m = subjectMap.get(currentDrawerCode);
    if (!m) return;
    const eff = getEffectiveRecord(m);
    saveCurrentDrawerChanges(!!drawerGradeInput.value, `Nota guardada: ${drawerGradeInput.value} en ${eff.displayName}`);
  });

  drawerDateInput.addEventListener('input', () => saveCurrentDrawerChanges(false));
  drawerNotesInput.addEventListener('input', () => saveCurrentDrawerChanges(false));

  drawerCloseBtn.addEventListener('click', () => subjectDrawer.close());

  // =========================================================================
  // 8. ELECTIVES & IDIOMAS SELECTOR MODAL
  // =========================================================================

  function openElectivesModal(slotCode) {
    hideMobilePill();
    currentModalSlotCode = slotCode;
    const slotSubject = subjectMap.get(slotCode);
    if (!slotSubject) return;

    electivesModalSlotMeta.textContent = `PLAN 2003 · ${slotSubject.year.toUpperCase()}`;
    electivesModalTitle.textContent = `Seleccionar ${slotSubject.name}`;

    const assigned = getAssignedElective(slotSubject);
    electivesModalSubtitle.textContent = assigned
      ? `Seleccionada actualmente: ${assigned.name}. Puedes cambiarla o quitarla.`
      : `Elige la materia correspondiente a ${slotSubject.name}.`;

    btnClearElective.style.display = assigned ? 'inline-flex' : 'none';

    const options = electivesCatalog[slotSubject.slot_type] || [];
    electivesListContainer.innerHTML = '';

    options.forEach(opt => {
      const isCurrent = assigned && assigned.code === opt.code;
      const card = document.createElement('div');
      card.className = `optativa-card ${isCurrent ? 'is-selected-here' : ''}`;

      card.innerHTML = `
        <div class="optativa-card-top">
          <span class="opt-code-badge">${opt.code}</span>
          <span class="opt-sem-tag">${opt.regimen}</span>
        </div>
        <div class="optativa-card-name">${opt.name}</div>
        <div class="optativa-card-desc">${opt.facultad_desc}</div>
        <div class="optativa-card-actions">
          ${isCurrent
            ? `<button type="button" class="btn-select-optativa is-selected" disabled>✓ Seleccionada</button>`
            : `<button type="button" class="btn-select-optativa btn-assign-action">Elegir materia</button>`}
        </div>
      `;

      const btn = card.querySelector('.btn-assign-action');
      if (btn) {
        btn.addEventListener('click', () => {
          const selections = getSelectedElectives();
          selections[slotCode] = opt.code;
          saveSelectedElectives(selections);
          electivesModal.close();
          applyStoredOverrides();
          renderMatrix();
          showToast(`✅ ${slotSubject.name}: ${opt.name}`);
          openDrawer(slotCode);
        });
      }

      electivesListContainer.appendChild(card);
    });

    if (!electivesModal.open) {
      electivesModal.showModal();
    }
  }

  electivesModalCloseBtn.addEventListener('click', () => electivesModal.close());

  btnClearElective.addEventListener('click', () => {
    if (!currentModalSlotCode) return;
    const selections = getSelectedElectives();
    delete selections[currentModalSlotCode];
    saveSelectedElectives(selections);
    electivesModal.close();
    applyStoredOverrides();
    renderMatrix();
    showToast('Espacio curricular liberado');
  });

  // =========================================================================
  // 9. STATE FILTERS (Aprobadas, En curso, Cursadas, Pendientes, Recursa)
  // =========================================================================

  function initLegendFilters() {
    const legendChips = document.querySelectorAll('.legend-chip[data-filter]');

    legendChips.forEach(chip => {
      const filter = chip.dataset.filter;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeStateFilter === filter) clearStateFilter();
        else applyStateFilter(filter);
      });

      chip.addEventListener('mouseenter', () => {
        if (!activeStateFilter) previewStateFilter(filter);
      });

      chip.addEventListener('mouseleave', () => {
        if (!activeStateFilter) clearStateFilter();
      });
    });

    const btnSideClearFilter = document.getElementById('btnSideClearFilter');
    if (btnSideClearFilter) {
      btnSideClearFilter.addEventListener('click', () => clearStateFilter());
    }

    mapViewport.addEventListener('click', (e) => {
      if ((e.target === mapViewport || e.target === matrixContainer) && activeStateFilter) {
        clearStateFilter();
      }
    });
  }

  function applyStateFilter(filter) {
    activeStateFilter = filter;
    matrixContainer.classList.add('has-state-filter');
    document.querySelectorAll('.legend-chip[data-filter]').forEach(c => {
      c.classList.toggle('is-active', c.dataset.filter === filter);
    });
    updateNodesFilterState(filter);
  }

  function previewStateFilter(filter) {
    matrixContainer.classList.add('has-state-filter');
    updateNodesFilterState(filter);
  }

  function clearStateFilter() {
    activeStateFilter = null;
    matrixContainer.classList.remove('has-state-filter');
    document.querySelectorAll('.legend-chip[data-filter]').forEach(c => c.classList.remove('is-active'));
    document.querySelectorAll('.subject-node').forEach(node => {
      node.classList.remove('is-filter-highlighted', 'is-filter-dimmed');
    });
  }

  function updateNodesFilterState(filter) {
    document.querySelectorAll('.subject-node').forEach(node => {
      const matches = filter === 'recursa'
        ? node.dataset.failed === 'true'
        : node.dataset.status === filter;

      node.classList.toggle('is-filter-highlighted', matches);
      node.classList.toggle('is-filter-dimmed', !matches);
    });
  }

  // =========================================================================
  // 10. BACKUP JSON, SIU GUARANÍ IMPORT & RESET
  // =========================================================================

  function exportAcademicStatus() {
    const exportData = {
      carrera: data.carrera,
      codigo_carrera: data.codigo_carrera,
      plan: data.plan,
      exportDate: new Date().toISOString(),
      promedio: data.promedio,
      stats: data.stats,
      selected_electives: getSelectedElectives(),
      cuat_placement: getPlacementOverrides(),
      overrides: getStoredOverrides()
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seguimiento_biologia_unlp_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Respaldo de notas guardado (JSON)');
  }

  function importJsonBackup(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      alert('El archivo JSON no tiene un formato válido.');
      return;
    }

    if (parsed.selected_electives && typeof parsed.selected_electives === 'object') {
      saveSelectedElectives({ ...getSelectedElectives(), ...parsed.selected_electives });
    }
    if (parsed.cuat_placement && typeof parsed.cuat_placement === 'object') {
      localStorage.setItem(PLACEMENT_KEY, JSON.stringify({ ...getPlacementOverrides(), ...parsed.cuat_placement }));
    }

    const overrides = getStoredOverrides();
    if (parsed.overrides && typeof parsed.overrides === 'object') {
      Object.assign(overrides, parsed.overrides);
    } else if (Array.isArray(parsed.materias)) {
      parsed.materias.forEach(item => {
        if (item && item.code) {
          overrides[item.code] = {
            status: item.status || 'pendiente',
            grade: item.grade ?? null,
            has_failed: !!item.has_failed,
            date: item.date || '',
            notes: item.notes || ''
          };
        }
      });
    }

    saveStoredOverrides(overrides);
    applyStoredOverrides();
    renderMatrix();
    showToast('✅ Respaldo cargado correctamente');
  }

  function loadExternalScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar el lector de archivos.'));
      document.head.appendChild(s);
    });
  }

  function normalizeText(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function matchGuaraniCode(actividad) {
    // Código entre paréntesis (tolerante a espacios que agrega el lector de PDF)
    const parens = [...actividad.matchAll(/\(\s*([A-Za-z0-9\- ]+?)\s*\)/g)];
    for (let i = parens.length - 1; i >= 0; i--) {
      const code = parens[i][1].replace(/\s+/g, '').toUpperCase();
      if (subjectMap.has(code) || findElectiveInCatalog(code)) return code;
    }
    const norm = normalizeText(actividad);
    for (const m of data.materias) {
      if (!m.is_elective_slot && normalizeText(m.name) === norm) return m.code;
    }
    for (const list of Object.values(electivesCatalog)) {
      for (const opt of list) {
        if (normalizeText(opt.name) === norm) return opt.code;
      }
    }
    return '';
  }

  function parseDateMs(dStr) {
    const parts = String(dStr || '').trim().split(/[\/\-]/);
    if (parts.length === 3) {
      return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10)).getTime();
    }
    return 0;
  }

  function parseGuaraniLine(line) {
    // 1. Formato Historia Académica: "Materia (COD) DD/MM/AAAA Tipo [Nota] [Resultado]"
    const dm = line.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
    if (dm) {
      const fecha = dm[1];
      const actividad = line.substring(0, dm.index).trim();
      const rest = line.substring(dm.index + fecha.length).trim();
      const code = matchGuaraniCode(actividad);
      if (!code) return null;

      let tipo = '';
      let nota = null;
      let resultado = '';
      if (/en\s+curso/i.test(rest)) {
        tipo = 'En curso';
        resultado = 'En curso';
      } else {
        const gm = rest.match(/\b([1-9]|10)([.,]\d+)?\b/);
        if (gm) nota = parseFloat(gm[0].replace(',', '.'));
        const tm = rest.match(/\b(Regularidad|Examen|Promoci[oó]n|Coloquio|Equivalencia|Resoluci[oó]n)\b/i);
        if (tm) tipo = tm[1];
        const rm = rest.match(/\b(Aprobado|Aprobada|Promocionado|Promocionada|Reprobado|Reprobada|Desaprobado|Desaprobada|Ausente)\b/i);
        if (rm) resultado = rm[1];
      }
      return { code, fecha, time: parseDateMs(fecha), tipo, nota, resultado };
    }

    // 2. Formato Plan de Estudios de Guaraní: "Materia (COD) Materia [Año] [Período] [Nota (Promocionado)] [Origen]"
    const planMatch = line.match(/^(.+?\(\s*[A-Za-z0-9\- ]+\s*\))\s+(?:\([!\*\-]\)\s+)?Materia\b(.*)$/i);
    if (planMatch) {
      const actividad = planMatch[1].trim();
      const rest = planMatch[2].trim();
      const code = matchGuaraniCode(actividad);
      if (!code) return null;

      if (/\ben\s+curso\b/i.test(rest)) {
        return { code, fecha: '', time: Date.now(), tipo: 'En curso', nota: null, resultado: 'En curso' };
      }

      const promoMatch = rest.match(/\b(10|[1-9](?:[.,]\d+)?)\s*\(\s*(Promocionad[oa]|Aprobad[oa])\s*\)/i);
      if (promoMatch) {
        return {
          code,
          fecha: '',
          time: Date.now(),
          tipo: 'Promocion',
          nota: parseFloat(promoMatch[1].replace(',', '.')),
          resultado: promoMatch[2]
        };
      }

      if (/\b(Promoci[oó]n|Examen|Equivalencia|Aprobad[oa])\b/i.test(rest)) {
        const notaMatch = rest.match(/(?:anual|cuatrimestres)\s+(10|[1-9](?:[.,]\d+)?)\b/i);
        return {
          code,
          fecha: '',
          time: Date.now(),
          tipo: 'Examen',
          nota: notaMatch ? parseFloat(notaMatch[1].replace(',', '.')) : null,
          resultado: 'Aprobado'
        };
      }

      if (/\bRegularidad\b/i.test(rest)) {
        return { code, fecha: '', time: Date.now(), tipo: 'Regularidad', nota: null, resultado: 'Aprobado' };
      }
    }

    return null;
  }

  function applyGuaraniRecords(records) {
    if (!records || records.length === 0) {
      alert('No se reconocieron materias del Profesorado de Ciencias Biológicas en el archivo.');
      return;
    }

    const grouped = {};
    records.forEach(r => {
      if (!grouped[r.code]) grouped[r.code] = [];
      grouped[r.code].push(r);
    });

    const overrides = getStoredOverrides();
    const selections = getSelectedElectives();
    let count = 0;

    Object.entries(grouped).forEach(([code, entries]) => {
      entries.sort((a, b) => a.time - b.time);
      let isApproved = false;
      let finalGrade = null;
      let cursadaAprobada = false;
      let hasFailed = false;
      let lastDate = entries[entries.length - 1].fecha || '';

      entries.forEach(e => {
        const t = (e.tipo || '').toLowerCase();
        const res = (e.resultado || '').toLowerCase();
        if (res.startsWith('aprobad') || res.startsWith('promocion')) {
          if (t === 'regularidad') {
            cursadaAprobada = true;
          } else {
            isApproved = true;
            if (e.nota !== null && !isNaN(e.nota)) finalGrade = e.nota;
          }
        } else if (res.startsWith('reprobad') || res.startsWith('desaprobad')) {
          if (!isApproved) {
            hasFailed = true;
            cursadaAprobada = false;
          }
        }
      });

      const last = entries[entries.length - 1];
      const lastRes = (last.resultado || '').toLowerCase();
      let status = 'pendiente';
      let grade = null;
      let failedFlag = false;

      if (isApproved) {
        status = 'aprobada';
        grade = finalGrade;
      } else if (lastRes === 'en curso' || (last.tipo || '').toLowerCase() === 'en curso') {
        status = 'en_curso';
      } else if (cursadaAprobada) {
        status = 'cursada_aprobada';
      } else if (hasFailed) {
        status = 'pendiente';
        failedFlag = true;
      }

      overrides[code] = {
        ...(overrides[code] || {}),
        status,
        grade,
        has_failed: failedFlag,
        date: lastDate
      };
      count++;

      // Ubicación automática de cuatrimestre (materias flexibles) según la fecha de cursada
      const subj = subjectMap.get(code);
      const cursadaEntry = [...entries].reverse().find(e => /en curso|regularidad/i.test(e.tipo || ''));
      if (subj && cursadaEntry && isFlexibleCuat(subj) && !getPlacementOverrides()[code]) {
        const month = parseInt(String(cursadaEntry.fecha).split('/')[1], 10);
        if (!isNaN(month)) savePlacementOverride(code, month >= 8 ? '2' : '1');
      }

      // Auto-assign elective/idioma slot if matched
      for (const [slotType, list] of Object.entries(electivesCatalog)) {
        if (list.some(opt => opt.code === code)) {
          const slot = data.materias.find(m => m.is_elective_slot && m.slot_type === slotType);
          if (slot && !selections[slot.code]) {
            selections[slot.code] = code;
          }
        }
      }
    });

    saveSelectedElectives(selections);
    saveStoredOverrides(overrides);
    applyStoredOverrides();
    renderMatrix();
    showToast(`📋 Historia Académica cargada: ${count} materias actualizadas`, 4500);
  }

  async function handleFileImport(file) {
    if (!file) return;
    const name = file.name.toLowerCase();

    if (name.endsWith('.json') || file.type === 'application/json') {
      const parsed = JSON.parse(await file.text());
      importJsonBackup(parsed);
      return;
    }

    if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const records = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const buckets = [];
        content.items.filter(it => it.str && it.str.trim()).forEach(it => {
          const y = it.transform ? it.transform[5] : 0;
          const x = it.transform ? it.transform[4] : 0;
          let b = buckets.find(bk => Math.abs(bk.y - y) <= 4);
          if (!b) { b = { y, items: [] }; buckets.push(b); }
          b.items.push({ x, str: it.str });
        });
        buckets.sort((a, b) => b.y - a.y);
        buckets.forEach(b => {
          b.items.sort((a, b) => a.x - b.x);
          const rec = parseGuaraniLine(b.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim());
          if (rec) records.push(rec);
        });
      }
      applyGuaraniRecords(records);
      return;
    }

    // CSV / TSV / XLS / XLSX
    const text = await file.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const records = lines.map(parseGuaraniLine).filter(Boolean);
    if (records.length > 0) {
      applyGuaraniRecords(records);
      return;
    }

    await loadExternalScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const xlRecords = rows.map(r => parseGuaraniLine(r.join(' '))).filter(Boolean);
    applyGuaraniRecords(xlRecords);
  }

  function resetAllData() {
    if (confirm('¿Seguro que querés borrar todas las notas, estados y materias elegidas?')) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(ELECTIVES_KEY);
      localStorage.removeItem(PLACEMENT_KEY);
      location.reload();
    }
  }

  // Wire Export / Import / Reset buttons
  ['btnExportNotes', 'btnSideExportNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', exportAcademicStatus);
  });

  ['btnResetNotes', 'btnSideResetNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', resetAllData);
  });

  ['inputImportNotes', 'inputSideImportNotes'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        showToast(`Procesando ${file.name}...`);
        await handleFileImport(file);
      } catch (err) {
        console.error(err);
        alert('No se pudo procesar el archivo: ' + (err.message || 'Formato no reconocido.'));
      } finally {
        input.value = '';
      }
    });
  });

  // =========================================================================
  // 11. SIDE MENU, MOBILE PILL, TOAST & INIT
  // =========================================================================

  const sideMenuDrawer = document.getElementById('sideMenuDrawer');
  const btnToggleSideMenu = document.getElementById('btnToggleSideMenu');
  const sideMenuCloseBtn = document.getElementById('sideMenuCloseBtn');

  if (btnToggleSideMenu && sideMenuDrawer) {
    btnToggleSideMenu.addEventListener('click', () => sideMenuDrawer.showModal());
  }
  if (sideMenuCloseBtn && sideMenuDrawer) {
    sideMenuCloseBtn.addEventListener('click', () => sideMenuDrawer.close());
  }

  // Backdrop click dismiss fallback for browsers without closedby="any"
  [subjectDrawer, electivesModal, sideMenuDrawer].forEach(dialog => {
    if (!dialog) return;
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside = rect.top <= event.clientY && event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX && event.clientX <= rect.left + rect.width;
      if (!inside) dialog.close();
    });
  });

  function showMobilePill(code) {
    const m = subjectMap.get(code);
    if (!m || !mobileActionPill) return;
    const eff = getEffectiveRecord(m);
    mobilePillCode.textContent = eff.displayCode;
    mobilePillName.textContent = eff.displayName;
    mobileActionPill.classList.add('is-visible');
  }

  function hideMobilePill() {
    if (!mobileActionPill) return;
    mobileActionPill.classList.remove('is-visible');
    mobileActiveCode = null;
  }

  if (mobilePillBtn) {
    mobilePillBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = mobileActiveCode;
      hideMobilePill();
      if (code) openDrawer(code);
    });
  }

  if (mobilePillClose) {
    mobilePillClose.addEventListener('click', (e) => {
      e.stopPropagation();
      hideMobilePill();
      clearFullChain();
    });
  }

  let toastTimer = null;
  function showToast(msg, duration = 2600) {
    if (!toastNotice) return;
    toastNotice.textContent = msg;
    toastNotice.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastNotice.classList.remove('show'), duration);
  }

  function flashSavedIndicator() {
    if (!drawerSavedIndicator) return;
    drawerSavedIndicator.classList.add('just-saved');
    setTimeout(() => drawerSavedIndicator.classList.remove('just-saved'), 450);
  }

  // =========================================================================
  // 12. DRAG & DROP: mover materias cuatrimestrales flexibles entre 1º y 2º cuat.
  // =========================================================================
  let draggingCode = null;

  function cleanupDragState() {
    draggingCode = null;
    matrixContainer.classList.remove('is-dragging-active');
    matrixContainer.querySelectorAll('.is-dragging').forEach(n => n.classList.remove('is-dragging'));
    matrixContainer.querySelectorAll('.drop-allowed, .drop-hover').forEach(c => c.classList.remove('drop-allowed', 'drop-hover'));
  }

  function setSubjectCuat(code, cuat) {
    const m = subjectMap.get(code);
    if (!m || !isFlexibleCuat(m) || getPlacement(m) === cuat) return;
    savePlacementOverride(code, cuat);
    renderMatrix();
    const eff = getEffectiveRecord(m);
    showToast(`${eff.displayName} → ${cuat}º cuatrimestre`);
    if (subjectDrawer.open && currentDrawerCode === code) syncDrawerCuatEditor(m);
  }

  matrixContainer.addEventListener('dragstart', (e) => {
    const node = e.target.closest && e.target.closest('.subject-node.is-draggable');
    if (!node) return;
    draggingCode = node.dataset.code;
    clearFullChain();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggingCode);
    requestAnimationFrame(() => node.classList.add('is-dragging'));
    const year = node.dataset.year;
    matrixContainer.querySelectorAll(`.cuat-column[data-year="${year}"]`).forEach(col => col.classList.add('drop-allowed'));
    matrixContainer.classList.add('is-dragging-active');
  });

  matrixContainer.addEventListener('dragend', cleanupDragState);
  window.addEventListener('dragend', cleanupDragState);

  matrixContainer.addEventListener('dragover', (e) => {
    if (!draggingCode) return;
    const col = e.target.closest && e.target.closest('.cuat-column.drop-allowed');
    if (!col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    matrixContainer.querySelectorAll('.drop-hover').forEach(c => { if (c !== col) c.classList.remove('drop-hover'); });
    col.classList.add('drop-hover');
  });

  matrixContainer.addEventListener('dragleave', (e) => {
    const col = e.target.closest && e.target.closest('.cuat-column');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop-hover');
  });

  matrixContainer.addEventListener('drop', (e) => {
    if (!draggingCode) return;
    const col = e.target.closest && e.target.closest('.cuat-column.drop-allowed');
    const code = draggingCode;
    cleanupDragState();
    if (!col) return;
    e.preventDefault();
    e.stopPropagation();
    setSubjectCuat(code, col.dataset.cuat);
  });

  // Selector de cuatrimestre dentro del modal (alternativa táctil al arrastre)
  const drawerCuatEditor = document.getElementById('drawerCuatEditor');

  function syncDrawerCuatEditor(m) {
    if (!drawerCuatEditor) return;
    if (!isFlexibleCuat(m)) {
      drawerCuatEditor.style.display = 'none';
      return;
    }
    drawerCuatEditor.style.display = 'flex';
    const current = getPlacement(m);
    drawerCuatEditor.querySelectorAll('button[data-cuat]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.cuat === current);
    });
  }

  if (drawerCuatEditor) {
    drawerCuatEditor.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-cuat]');
      if (btn && currentDrawerCode) setSubjectCuat(currentDrawerCode, btn.dataset.cuat);
    });
  }

  // Arrastrar y soltar el PDF / JSON de Guaraní en cualquier parte de la página
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', async (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    try {
      showToast(`Procesando ${file.name}...`);
      await handleFileImport(file);
    } catch (err) {
      console.error(err);
      alert('No se pudo procesar el archivo: ' + (err.message || 'Formato no reconocido.'));
    }
  });

  window.__syncDrawerCuatEditor = syncDrawerCuatEditor;

  // Initial Boot
  applyStoredOverrides();
  renderMatrix();
  initLegendFilters();
});
