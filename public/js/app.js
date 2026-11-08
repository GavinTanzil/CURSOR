document.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
        const dlg = document.getElementById(btn.dataset.open);
        if (dlg && dlg.showModal){
          dlg.showModal();
        const first = dlg.querySelector('input:not([type=hidden])');
        if (first) 
          first.focus();
        }
      }
    );
  }
);

document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (ev) => { 
    if (ev.target === dlg) 
      dlg.close(); }
    );
  }
);

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('dialog').close());
  }
);


document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (ev) => {
    if (!window.confirm(form.dataset.confirm)) ev.preventDefault();
    }
  );
});
