(function() {
  const WS_URL = 'ws://' + window.location.host;
  let ws = null;
  let eventQueue = [];

  function connect() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      eventQueue.forEach(e => ws.send(JSON.stringify(e)));
      eventQueue = [];
      const statusEl = document.querySelector('.status');
      if (statusEl) {
        statusEl.textContent = 'Connected';
        statusEl.style.color = 'var(--success)';
      }
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === 'reload') {
        window.location.reload();
      }
    };

    ws.onclose = () => {
      const statusEl = document.querySelector('.status');
      if (statusEl) {
        statusEl.textContent = 'Reconnecting...';
        statusEl.style.color = 'var(--warning)';
      }
      setTimeout(connect, 1000);
    };
  }

  function sendEvent(event) {
    event.timestamp = Date.now();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    } else {
      eventQueue.push(event);
    }
  }

  function handleChoiceInteraction(target) {
    if (!target) return;

    sendEvent({
      type: 'click',
      text: target.textContent.trim(),
      choice: target.dataset.choice,
      id: target.id || null
    });

    // Update indicator bar (defer so toggleSelect runs first)
    setTimeout(() => {
      const indicator = document.getElementById('indicator-text');
      if (!indicator) return;
      const container = target.closest('.options') || target.closest('.cards');
      const selected = container ? container.querySelectorAll('.selected') : [];
      if (selected.length === 0) {
        indicator.textContent = 'Click an option above, then return to the terminal';
      } else if (selected.length === 1) {
        const label = selected[0].querySelector('h3, .content h3, .card-body h3')?.textContent?.trim() || selected[0].dataset.choice;
        indicator.innerHTML = '<span class="selected-text">' + label + ' selected</span> — return to terminal to continue';
      } else {
        indicator.innerHTML = '<span class="selected-text">' + selected.length + ' selected</span> — return to terminal to continue';
      }
    }, 0);
  }

  // Keyboard accessibility for choices
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const target = e.target.closest('[data-choice]');
      if (target) {
        e.preventDefault();
        if (window.toggleSelect) {
            window.toggleSelect(target);
        }
        handleChoiceInteraction(target);
      }
    }
  });

  // Automatically make injected choices accessible
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) { // ELEMENT_NODE
          const choices = node.matches && node.matches('[data-choice]') ? [node] : node.querySelectorAll('[data-choice]');
          choices.forEach(choice => {
            if (!choice.hasAttribute('tabindex')) choice.setAttribute('tabindex', '0');
            if (!choice.hasAttribute('role')) choice.setAttribute('role', 'button');
            if (!choice.hasAttribute('aria-pressed')) choice.setAttribute('aria-pressed', choice.classList.contains('selected') ? 'true' : 'false');
          });
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial pass for elements already in DOM
  document.querySelectorAll('[data-choice]').forEach(choice => {
    if (!choice.hasAttribute('tabindex')) choice.setAttribute('tabindex', '0');
    if (!choice.hasAttribute('role')) choice.setAttribute('role', 'button');
    if (!choice.hasAttribute('aria-pressed')) choice.setAttribute('aria-pressed', choice.classList.contains('selected') ? 'true' : 'false');
  });

  // Capture clicks on choice elements
  document.addEventListener('click', (e) => {
    handleChoiceInteraction(e.target.closest('[data-choice]'));
  });

  // Frame UI: selection tracking
  window.selectedChoice = null;

  window.toggleSelect = function(el) {
    const container = el.closest('.options') || el.closest('.cards');
    const multi = container && container.dataset.multiselect !== undefined;
    if (container && !multi) {
      container.querySelectorAll('.option, .card').forEach(o => {
        o.classList.remove('selected');
        o.setAttribute('aria-pressed', 'false');
      });
    }
    if (multi) {
      const isSelected = el.classList.toggle('selected');
      el.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    } else {
      el.classList.add('selected');
      el.setAttribute('aria-pressed', 'true');
    }
    window.selectedChoice = el.dataset.choice;
  };

  // Expose API for explicit use
  window.brainstorm = {
    send: sendEvent,
    choice: (value, metadata = {}) => sendEvent({ type: 'choice', value, ...metadata })
  };

  connect();
})();
