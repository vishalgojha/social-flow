const chalk = require('chalk');
const inquirer = require('inquirer');
const { formatParsedIntent } = require('./format');

function parseUserChoice(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value || value === 'y' || value === 'yes') return 'y';
  if (value === 'n' || value === 'no' || value === 'cancel') return 'n';
  if (value === 'edit' || value === 'e') return 'edit';
  if (value === 'details' || value === 'd') return 'details';
  return 'details';
}

async function promptChoiceWithInk() {
  try {
    const React = await import('react');
    const ink = await import('ink');
    const inkTextInput = await import('ink-text-input');
    const TextInput = inkTextInput.default;
    const { render, Box, Text, useApp } = ink;

    return await new Promise((resolve) => {
      function App() {
        const [value, setValue] = React.useState('');
        const { exit } = useApp();
        return React.createElement(
          Box,
          { flexDirection: 'column' },
          React.createElement(Text, null, 'Confirm? [Y/n/edit/details]'),
          React.createElement(TextInput, {
            value,
            onChange: setValue,
            onSubmit: (input) => {
              resolve(parseUserChoice(input));
              exit();
            }
          })
        );
      }

      render(React.createElement(App));
    });
  } catch {
    return null;
  }
}

async function promptChoiceFallback() {
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'Confirm?',
      choices: [
        { name: 'Y: Execute immediately', value: 'y' },
        { name: 'n: Cancel', value: 'n' },
        { name: 'edit: Modify parsed fields', value: 'edit' },
        { name: 'details: Show full parsed payload', value: 'details' }
      ]
    }
  ]);
  return answer.choice;
}

async function editIntentFields(intent) {
  const editableFields = [
    'api',
    'message',
    'caption',
    'page',
    'link',
    'imageUrl',
    'phone',
    'phoneId',
    'businessId',
    'platform',
    'accountId',
    'recipientId',
    'recipientList',
    'messageBody',
    'packageName',
    'version',
    'connectorType',
    'connectorId',
    'callbackUrl',
    'verifyToken',
    'intentId',
    'domain',
    'metricType',
    'dailyBudget',
    'datetime',
    'accountId',
    'preset',
    'name',
    'objective',
    'budget',
    'status'
  ];

  const current = { ...(intent || {}) };
  const askField = await inquirer.prompt([
    {
      type: 'list',
      name: 'field',
      message: 'Pick field to edit:',
      choices: editableFields.map((f) => ({
        name: `${f}: ${current[f] === null || current[f] === undefined || current[f] === '' ? '-' : String(current[f])}`,
        value: f
      }))
    }
  ]);

  const askValue = await inquirer.prompt([
    {
      type: 'input',
      name: 'value',
      message: `Enter new value for ${askField.field} (empty => null):`
    }
  ]);

  const value = String(askValue.value || '').trim();
  current[askField.field] = value ? value : null;
  return current;
}

/**
 * Show a confirmation UI before executing parsed AI intents.
 * Uses Ink when available, otherwise falls back to inquirer.
 * @param {object} intent
 * @param {object} [options]
 * @param {boolean} [options.useInk]
 * @returns {Promise<{confirmed: boolean, intent: object}>}
 */
async function showConfirmation(intent, options = {}) {
  let workingIntent = { ...(intent || {}) };
  const useInk = Boolean(options.useInk);

  while (true) {
    console.log('');
    console.log(chalk.bold(formatParsedIntent(workingIntent)));
    console.log('');

    if (!process.stdout.isTTY) {
      return { confirmed: false, intent: workingIntent };
    }

    let choice = null;
    if (useInk) {
      choice = await promptChoiceWithInk();
    }
    if (!choice) {
      choice = await promptChoiceFallback();
    }

    if (choice === 'y') {
      return { confirmed: true, intent: workingIntent };
    }
    if (choice === 'n') {
      return { confirmed: false, intent: workingIntent };
    }
    if (choice === 'details') {
      console.log(chalk.gray('\nParsed payload:'));
      console.log(JSON.stringify(workingIntent, null, 2));
      console.log('');
      continue;
    }
    if (choice === 'edit') {
      workingIntent = await editIntentFields(workingIntent);
      continue;
    }
  }
}

module.exports = {
  showConfirmation,
  parseUserChoice
};
