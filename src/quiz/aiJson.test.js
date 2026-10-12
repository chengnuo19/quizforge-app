import { describe, it, expect } from 'vitest';
import { parseAiJson } from './aiJson';

describe('parseAiJson', () => {
  it('解析纯 JSON', () => {
    const input = '{"prompt": "问题 1", "type": "single", "options": [{"text": "A", "correct": true}]}';
    const result = parseAiJson(input);
    expect(result).toEqual({
      prompt: '问题 1',
      type: 'single',
      options: [{ text: 'A', correct: true }],
    });
  });

  it('解析被 ```json 包裹的 JSON', () => {
    const input = '```json\n{\n  "bookId": "b1",\n  "reason": "内容匹配"\n}\n```';
    const result = parseAiJson(input);
    expect(result).toEqual({
      bookId: 'b1',
      reason: '内容匹配',
    });
  });

  it('解析被 ```（无语言标识）包裹的 JSON', () => {
    const input = '```\n{"key": "value"}\n```';
    const result = parseAiJson(input);
    expect(result).toEqual({ key: 'value' });
  });

  it('解析前后带说明文字的 JSON', () => {
    const input = '好的，这是解析后的结果：\n```json\n{"prompt": "题干", "explanation": "解析"}\n```\n希望对您有帮助！';
    const result = parseAiJson(input);
    expect(result).toEqual({
      prompt: '题干',
      explanation: '解析',
    });
  });

  it('解析前后带纯文字（无代码块）的 JSON', () => {
    const input = '提取结果如下：{"prompt": "题干", "valid": true} 请查收。';
    const result = parseAiJson(input);
    expect(result).toEqual({
      prompt: '题干',
      valid: true,
    });
  });

  it('非法输入时抛出“AI 返回的不是有效 JSON”错误', () => {
    expect(() => parseAiJson('')).toThrow('AI 返回的不是有效 JSON');
    expect(() => parseAiJson(null)).toThrow('AI 返回的不是有效 JSON');
    expect(() => parseAiJson(undefined)).toThrow('AI 返回的不是有效 JSON');
    expect(() => parseAiJson('这是一段普通的纯文字，没有任何花括号')).toThrow('AI 返回的不是有效 JSON');
    expect(() => parseAiJson('{"invalidJson": }')).toThrow('AI 返回的不是有效 JSON');
    expect(() => parseAiJson('} 颠倒括号 {')).toThrow('AI 返回的不是有效 JSON');
  });
});
