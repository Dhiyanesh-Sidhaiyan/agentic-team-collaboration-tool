const fs = require('fs');
const path = require('path');

function checkProjectQuality() {
  console.log('--- Project Quality & Security Audit ---');
  
  const serverPath = path.join(__dirname, 'server.js');
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  
  const packagePath = path.join(__dirname, 'package.json');
  const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  const criteria = [
    { name: 'Helmet Security', pattern: /helmet\(/, description: 'Secure headers implementation' },
    { name: 'Cloud Logging', pattern: /LoggingWinston/, description: 'GCP Logging integration' },
    { name: 'Cloud Storage', pattern: /new Storage\(/, description: 'GCP Storage integration' },
    { name: 'Secret Manager', pattern: /SecretManagerServiceClient/, description: 'Secure key management' },
    { name: 'Real-time Socket', pattern: /new Server\(server/, description: 'Socket.io implementation' },
    { name: 'AI Integration', pattern: /\/api\/ai\/summarize/, description: 'AI API endpoint' }
  ];

  let passed = 0;
  criteria.forEach(c => {
    if (c.pattern.test(serverContent)) {
      console.log(`✅ [PASSED] ${c.name}: ${c.description}`);
      passed++;
    } else {
      console.log(`❌ [FAILED] ${c.name}: ${c.description}`);
    }
  });

  console.log(`\nAudit Score: ${passed}/${criteria.length}`);
}

checkProjectQuality();
