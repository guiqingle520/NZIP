let token = '';
const $ = id => document.getElementById(id), status = message => { $('status').textContent = message; };
async function api(route, payload) {
  const response = await fetch('/v1/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(payload) });
  const data = await response.json(); if (!data.ok) throw new Error(data.error); return data;
}
$('send').onclick = async () => {
  $('send').disabled = true;
  try { await api('email-code', { email: $('email').value }); status('如邮箱与购买记录一致，验证码将发送到该邮箱，10 分钟内有效。'); } catch (e) { status(e.message); }
  finally { setTimeout(() => { $('send').disabled = false; }, 60000); }
};
async function refresh() {
  const data = await api('devices', {}); $('devices').replaceChildren();
  for (const d of data.devices) {
    const row = document.createElement('article'), title = document.createElement('p'), button = document.createElement('button');
    title.textContent = `${d.deviceName || '未命名电脑'} · 客户 ${d.customerRef} · ${d.active ? '占用名额' : '已解绑'}`;
    button.textContent = '解绑并释放名额'; button.disabled = !d.active;
    button.onclick = async () => {
      if (!confirm('确认解绑此电脑并释放名额？')) return;
      button.disabled = true;
      try { await api('deactivate', { requestId: crypto.randomUUID(), bindingId: d.bindingId, generation: d.generation }); await refresh(); status('解绑成功，名额已释放。'); } catch (e) { status(e.message); button.disabled = false; }
    };
    row.append(title, button); $('devices').append(row);
  }
  if (!data.devices.length) status('此邮箱暂没有已激活的设备，请检查购买邮箱是否正确。');
}
$('verify').onsubmit = async e => {
  e.preventDefault();
  try { token = (await api('email-verify', { email: $('email').value, code: $('code').value })).sessionToken; $('code').value = ''; await refresh(); status('验证成功，可管理设备。'); } catch (error) { token = ''; status(error.message); }
};
