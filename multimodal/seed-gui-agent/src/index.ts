/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LocalBrowser } from '@agent-infra/browser';
import { BrowserOperator } from '@gui-agent/operator-browser';
import { ComputerOperator } from './ComputerOperator';
import { getAndroidDeviceId, AdbOperator } from '@ui-tars/operator-adb';
import { SeedGUIAgent } from './SeedGUIAgent';
import { env } from 'process';
import { Command } from 'commander';

function validateEnvironmentVariables() {
  if (!env.SEED_BASE_URL || !env.SEED_MODEL || !env.SEED_API_KEY) {
    console.error('❌ 缺少必需的环境变量:');
    if (!env.SEED_BASE_URL) console.error('  - SEED_BASE_URL 未设置');
    if (!env.SEED_MODEL) console.error('  - SEED_MODEL 未设置');
    if (!env.SEED_API_KEY) console.error('  - SEED_API_KEY 未设置');
    console.error('请设置所有必需的环境变量后重试。');
    process.exit(1);
  }
}

function getModelConfig() {
  return {
    baseURL: env.SEED_BASE_URL!,
    id: env.SEED_MODEL!,
    apiKey: env.SEED_API_KEY!,
    uiTarsVersion: 'doubao-1.5-ui-tars-20b',
  } as const;
}

async function testBrowserOperator() {
  console.log('🌐 Testing Browser Operator...');

  const browser = new LocalBrowser();
  const browserOperator = new BrowserOperator({
    browser,
    browserType: 'chrome',
    logger: undefined,
    highlightClickableElements: false,
    showActionInfo: false,
  });

  await browser.launch();
  const openingPage = await browser.createPage();
  await openingPage.goto('https://www.google.com/', {
    waitUntil: 'networkidle2',
  });

  const seedGUIAgentForBrowser = new SeedGUIAgent({
    operator: browserOperator,
    model: getModelConfig(),
  });

  const browserResponse = await seedGUIAgentForBrowser.run({
    input: [{ type: 'text', text: 'What is Agent TARS' }],
  });

  console.log('\n📝 Agent with Browser Operator Response:');
  console.log('================================================');
  console.log(browserResponse.content);
  console.log('================================================');

  await browser.close();
}

async function testComputerOperator() {
  console.log('💻 Testing Computer Operator...');

  const computerOperator = new ComputerOperator();
  const seedGUIAgentForComputer = new SeedGUIAgent({
    operator: computerOperator,
    model: getModelConfig(),
  });

  const computerResponse = await seedGUIAgentForComputer.run({
    input: [{ type: 'text', text: 'What is Agent TARS' }],
  });

  console.log('\n📝 Agent with Computer Operator Response:');
  console.log('================================================');
  console.log(computerResponse.content);
  console.log('================================================');
}

async function testAndroidOperator() {
  console.log('📱 Testing Android Operator...');

  const deviceId = await getAndroidDeviceId();
  if (deviceId == null) {
    console.error('No Android devices found. Please connect a device and try again.');
    process.exit(0);
  }

  const adbOperator = new AdbOperator(deviceId);
  const seedGUIAgentForAndroid = new SeedGUIAgent({
    operator: adbOperator,
    model: getModelConfig(),
  });

  const androidResponse = await seedGUIAgentForAndroid.run({
    input: [{ type: 'text', text: 'What is Agent TARS' }],
  });

  console.log('\n📝 Agent with Android Operator Response:');
  console.log('================================================');
  console.log(androidResponse.content);
  console.log('================================================');
}

async function testAllOperators() {
  console.log('🚀 Testing All Operators...');
  await testBrowserOperator();
  await testComputerOperator();
  await testAndroidOperator();
}

async function main() {
  validateEnvironmentVariables();

  const program = new Command();
  program
    .name('seed-gui-agent-test')
    .description('Test SeedGUIAgent with different operators')
    .version('1.0.0');

  program
    .option('-t, --target <target>', 'The target operator (browser|computer|android|all)', 'all')
    .action(async (options) => {
      const { target } = options;
      switch (target.toLowerCase()) {
        case 'browser':
          await testBrowserOperator();
          break;
        case 'computer':
          await testComputerOperator();
          break;
        case 'android':
          await testAndroidOperator();
          break;
        case 'all':
          await testAllOperators();
          break;
        default:
          console.error(`❌ 未知的目标类型: ${target}`);
          console.error('支持的类型: browser, computer, android, all');
          process.exit(1);
      }
    });

  await program.parseAsync(process.argv);
}

if (require.main === module) {
  main().catch(console.error);
}
