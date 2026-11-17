import { connect, checkServerIdentity } from 'node:tls';
import { isIP } from 'node:net';

export function negotiateVersion(host, address, version, timeout) {
  const name = host.replace(/^\[|\]$/g, '');
  return new Promise((resolve) => {
    let timer;
    const finish = (status) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(status);
    };
    const socket = connect({
      host: address,
      port: 443,
      servername: isIP(name) ? undefined : name,
      minVersion: version,
      maxVersion: version,
      rejectUnauthorized: true,
      checkServerIdentity: (_host, cert) => checkServerIdentity(name, cert),
    }, () => finish(socket.getProtocol() === version ? 'accepted' : 'unchecked'));
    socket.once('error', (error) => finish(error.code === 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION' ? 'rejected' : 'unchecked'));
    timer = setTimeout(() => finish('unchecked'), timeout);
  });
}
