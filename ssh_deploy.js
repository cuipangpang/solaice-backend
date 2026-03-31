const { Client } = require('ssh2');

function runSSH(commands, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error('SSH timeout'));
    }, timeoutMs);

    conn.on('ready', () => {
      conn.exec(commands, (err, stream) => {
        if (err) { clearTimeout(timer); conn.end(); return reject(err); }
        let out = '', errOut = '';
        stream.on('data', d => out += d);
        stream.stderr.on('data', d => errOut += d);
        stream.on('close', (code) => {
          clearTimeout(timer);
          conn.end();
          resolve({ code, out, errOut });
        });
      });
    }).on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    }).connect({
      host: '43.164.134.43',
      port: 22,
      username: 'ubuntu',
      password: 'Pcy15143230380@',
      tryKeyboard: true,
      readyTimeout: 30000
    });
    conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      finish(['Pcy15143230380@']);
    });
  });
}

const step = process.argv[2];

const cmds = {
  step1: `sudo bash -c 'cd /opt/solaice && git fetch origin main && git reset --hard origin/main && echo "CODE_UPDATED:$(git log --oneline -1)"'`,

  step2: `cd /opt/solaice/backend && sudo docker compose exec -T api python scripts/migrate_chat_tables.py 2>&1`,

  step3: `
ENV_FILE=/opt/solaice/backend/.env
grep -q 'REDIS_URL' $ENV_FILE || echo 'REDIS_URL=redis://redis:6379/0' >> $ENV_FILE
grep -q 'CHAT_MAX_TURNS' $ENV_FILE || echo 'CHAT_MAX_TURNS=20' >> $ENV_FILE
grep -q 'CHAT_SUMMARY_INTERVAL' $ENV_FILE || echo 'CHAT_SUMMARY_INTERVAL=5' >> $ENV_FILE
grep -q 'TAVILY_API_KEY' $ENV_FILE || echo 'TAVILY_API_KEY=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' >> $ENV_FILE
grep -q 'QWEN_API_KEY' $ENV_FILE && echo 'QWEN_KEY_STATUS:EXISTS' || echo 'QWEN_KEY_STATUS:MISSING'
grep -q 'TAVILY_API_KEY' $ENV_FILE && echo 'TAVILY_KEY_STATUS:EXISTS' || echo 'TAVILY_KEY_STATUS:MISSING'
echo '--- .env (values hidden) ---'
sed 's/=.*/=***/' $ENV_FILE
  `,

  step4: `cd /opt/solaice/backend && docker compose restart backend-api && sleep 10 && docker compose ps backend-api`,

  step5: `
for i in 1 2 3 4 5; do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/api/v1/health 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "HEALTH_OK"
    curl -s http://localhost:8000/api/v1/health
    exit 0
  fi
  echo "HEALTH_WAIT:$i STATUS:$STATUS"
  sleep 5
done
echo "HEALTH_FAIL"
cd /opt/solaice/backend && docker compose logs backend-api --tail=50
  `,

  step6: `cd /opt/solaice/backend && docker compose exec -T backend-db-1 psql -U postgres -d solaice_db -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;" 2>&1`
};

if (!cmds[step]) {
  console.error('Usage: node ssh_deploy.js <step1|step2|step3|step4|step5|step6>');
  process.exit(1);
}

console.log(`\n=== ${step.toUpperCase()} ===`);
runSSH(cmds[step], 180000).then(r => {
  if (r.out) console.log(r.out.trim());
  if (r.errOut) console.log('[STDERR]', r.errOut.trim());
  console.log(`[EXIT CODE: ${r.code}]`);
}).catch(e => {
  console.error('[ERROR]', e.message);
  process.exit(1);
});
