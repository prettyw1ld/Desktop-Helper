// Вместо SIEM: принимает syslog по UDP на порту 5514 и печатает события Пушика.
import dgram from 'node:dgram';
const s = dgram.createSocket('udp4');
s.on('message', (m) => console.log(String(m).replace(/^.*?CEF:/, 'CEF:')));
s.bind(5514, '127.0.0.1', () => console.log('журнал для SIEM: жду события на udp://127.0.0.1:5514'));
