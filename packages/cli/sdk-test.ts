// packages/cli/sdk-test.ts
import { createClient } from '@flux/sdk';

const flux = createClient("http://api.final-win.flux.localhost");

async function runTest() {
  console.log('📡 Calling the Flux API...');

  const { data, error } = await flux.from('messages').select('*');

  if (error) {
    console.error('❌ Test Failed:', error);
  } else {
    console.log('✅ Test Succeeded!');
    console.table(data);
  }
}

runTest();