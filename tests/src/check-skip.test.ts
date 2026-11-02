import { describe, expect, it } from 'vitest';

import { main } from '#src/check-skip';

describe('the check-skip script', () => {
  it.each([
    {
      name: 'nothing',
      skip: '',
    },
    {
      name: 'an empty list',
      skip: '[]',
    },
    {
      name: 'every group',
      skip: '["bump", "check", "deploy", "publish", "review", "security"]',
    },
    {
      name: 'jobs of every group',
      skip: '["changelog","dispatch","fragments","gitleaks","hygiene","images","matrix","merge","npm"]',
    },
    {
      name: 'the remaining jobs',
      skip: '["osv-scanner","packagist","pages","production","release","reword","semgrep","staging","testing","trivy"]',
    },
  ])('passes $name', (scenario) => {
    expect(main([`--skip=${scenario.skip}`])).toBe(0);
  });

  it('fails, naming each, for skip names it does not know', () => {
    expect(() => main(['--skip=["lint","npm","Check"]']))
      .toThrow('Unknown skip name "lint".\nUnknown skip name "Check".');
  });

  it('fails, naming the parser\'s reason, for a list that is no JSON', () => {
    expect(() => main(['--skip={']))
      .toThrow('Skip list must be a JSON array of names, "{" given: JSON Parse error: Expected \'}\'.');
  });

  it.each([
    {
      skip: '"npm"',
    },
    {
      skip: '{"npm": true}',
    },
    {
      skip: '["npm",1]',
    },
  ])('fails for $skip, which is no JSON array of names', (scenario) => {
    expect(() => main([`--skip=${scenario.skip}`]))
      .toThrow(`Skip list must be a JSON array of names, "${scenario.skip}" given.`);
  });
});
