import { describe, it, expect } from 'vitest'
import { parseQuiz } from './parseQuiz.js'

const HAPPY = `---
title: 排序算法测验
sources: 5
---

## 哪个排序在最坏情况下仍为 $O(n \\log_2 n)$ 且不稳定？

- [ ] 归并排序
  归并排序最坏 $O(n\\log_2 n)$，但稳定。
- [ ] 冒泡排序
  冒泡排序最坏 $O(n^2)$。
- [x] 堆排序
  堆排序均为 $O(n\\log_2 n)$，不稳定。

> Explain: 堆排序的交换是跨距离的。

## 第二题没有详解也可以

- [x] 对
- [ ] 错
`

describe('parseQuiz', () => {
  it('parses metadata, questions, options and explanations', () => {
    const quiz = parseQuiz(HAPPY)
    expect(quiz.title).toBe('排序算法测验')
    expect(quiz.sources).toBe(5)
    expect(quiz.questions).toHaveLength(2)

    const q1 = quiz.questions[0]
    expect(q1.options).toHaveLength(3)
    expect(q1.options.map((o) => o.label)).toEqual(['A', 'B', 'C'])
    expect(q1.options[2].correct).toBe(true)
    expect(q1.options[0].correct).toBe(false)
    expect(q1.options[0].explanation).toContain('归并排序最坏')
    expect(q1.explain).toBe('堆排序的交换是跨距离的。')

    const q2 = quiz.questions[1]
    expect(q2.options[0].correct).toBe(true)
    expect(q2.explain).toBeUndefined()
  })

  it('strips a manually typed "A." prefix from option text', () => {
    const quiz = parseQuiz(`## Q\n- [x] A. 第一项\n- [ ] B. 第二项\n`)
    expect(quiz.questions[0].options[0].text).toBe('第一项')
    expect(quiz.questions[0].options[1].text).toBe('第二项')
  })

  it('defaults the title when no front matter is given', () => {
    const quiz = parseQuiz(`## Q\n- [x] yes\n- [ ] no\n`)
    expect(quiz.title).toBe('未命名测验')
    expect(quiz.sources).toBeUndefined()
  })

  it('throws on empty input', () => {
    expect(() => parseQuiz('')).toThrow()
    expect(() => parseQuiz('   ')).toThrow()
  })

  it('throws when there are no questions', () => {
    expect(() => parseQuiz('just some text\n- [x] not under a heading')).toThrow(/题目/)
  })

  it('throws when a question has no correct answer', () => {
    expect(() => parseQuiz('## Q\n- [ ] a\n- [ ] b\n')).toThrow(/正确答案/)
  })

  it('marks a question with multiple correct answers as multi-select', () => {
    const quiz = parseQuiz('## Q\n- [x] a\n- [x] b\n- [ ] c\n')
    expect(quiz.questions[0].multi).toBe(true)
    expect(quiz.questions[0].options.filter((o) => o.correct)).toHaveLength(2)
  })

  it('marks a single-answer question as not multi', () => {
    const quiz = parseQuiz('## Q\n- [x] a\n- [ ] b\n')
    expect(quiz.questions[0].multi).toBe(false)
  })

  it('ignores headings that have no options (treating them as section headings)', () => {
    const quiz = parseQuiz('## Q\n\n## Q2\n- [x] a\n')
    expect(quiz.questions).toHaveLength(1)
    expect(quiz.questions[0].prompt).toBe('Q2')
  })

  it('does not treat "##" or "- [ ]" inside a fenced code block as structure', () => {
    const md = [
      '## 真正的题目',
      '- [x] 正确',
      '  解释里有代码：',
      '  ```md',
      '  ## 这不是新题目',
      '  - [ ] 这也不是选项',
      '  ```',
      '- [ ] 错误',
    ].join('\n')
    const quiz = parseQuiz(md)
    expect(quiz.questions).toHaveLength(1)
    expect(quiz.questions[0].options).toHaveLength(2)
    expect(quiz.questions[0].options[0].explanation).toContain('## 这不是新题目')
    expect(quiz.questions[0].options[0].explanation).toContain('```md')
  })

  it('keeps image markdown in prompts', () => {
    const quiz = parseQuiz('## 看图 ![x](a.png)\n- [x] a\n- [ ] b\n')
    expect(quiz.questions[0].prompt).toContain('![x](a.png)')
  })

  it('parses options with bullet prefixes and different bold styles', () => {
    const md = [
      '## Q1',
      '* A. 选项1',
      '- **B.** 选项2',
      '1. **C**. 选项3',
      '正确答案：B'
    ].join('\n')
    const quiz = parseQuiz(md)
    expect(quiz.questions[0].options).toHaveLength(3)
    expect(quiz.questions[0].options[0].text).toBe('选项1')
    expect(quiz.questions[0].options[1].text).toBe('选项2')
    expect(quiz.questions[0].options[1].correct).toBe(true)
    expect(quiz.questions[0].options[2].text).toBe('选项3')
  })

  it('parses judgment questions without explicit options', () => {
    const md = [
      '## 第一题',
      '对于不同关键字可能得到同一哈希地址，这种现象称为冲突。',
      '* **正确答案：** 对',
      '* **详细解析：** 散列（哈希）函数是将任意长度的输入...'
    ].join('\n')
    const quiz = parseQuiz(md)
    expect(quiz.questions).toHaveLength(1)
    expect(quiz.questions[0].options).toHaveLength(2)
    expect(quiz.questions[0].options[0].text).toBe('对')
    expect(quiz.questions[0].options[0].correct).toBe(true)
    expect(quiz.questions[0].options[1].text).toBe('错')
    expect(quiz.questions[0].options[1].correct).toBe(false)
    expect(quiz.questions[0].explain).toBe('散列（哈希）函数是将任意长度的输入...')
  })

  it('parses correct answers and explanations on general lines', () => {
    const md = [
      '## Q1',
      'A. 选项A',
      'B. 选项B',
      '正确答案：B',
      '详细解析：',
      '解析第一行',
      '解析第二行'
    ].join('\n')
    const quiz = parseQuiz(md)
    expect(quiz.questions[0].options[1].correct).toBe(true)
    expect(quiz.questions[0].explain).toBe('解析第一行\n解析第二行')
  })

  it('parses the user provided markdown correctly', () => {
    const md = `## 第 1 题
**题目描述：** 对于不同关键字可能得到同一哈希地址，即 $key_1 \\neq key_2$，而 $f(key_1) = f(key_2)$，这种现象称为冲突。
* **正确答案：** 对
* **详细解析：** 散列（哈希）函数是将任意长度的输入（关键字空间）通过特定的散列算法变换成固定长度的输出（散列地址空间）。由于输入空间通常远大于输出空间，不同的输入关键字可能会被映射到同一个散列地址上。这种 $key_1 \\neq key_2$ 却有 $f(key_1) = f(key_2)$ 的现象就被定义为**散列冲突（Collision）**。

## 第 2 题
**题目描述：** 二叉排序树的任意一棵子树也是二叉排序树。
* **正确答案：** 对
* **详细解析：** 根据二叉排序树（Binary Sort Tree, BST）的递归定义：
  1. 若左子树不空，则左子树上所有结点的值均小于它的根结点的值；
  2. 若右子树不空，则右子树上所有结点的值均大于它的根结点的值；
  3. 它的左、右子树也分别为二叉排序树。
  
  因此，二叉排序树的定义具有递归性质，其任意一棵非空子树都必须严格满足二叉排序树的所有特征。

## 第 3 题
**题目描述：** 哈希表的查找效率主要取决于构造哈希表选取的哈希函数 and 处理冲突的方法。
* **正确答案：** 对
* **详细解析：** 哈希表的平均查找长度（ASL）主要取决于三个因素：**哈希函数**、**处理冲突的方法**以及**装填因子（$\\alpha$）**。
  * 一个优秀的哈希函数能让地址分布更均匀，从而**减少冲突**。
  * 良好的冲突处理方法（如线性探测、链地址法等）能让冲突发生时**降低再查找的代价**。
  
  因此，题目中提到主要取决于这两个因素是正确的。

## 第 4 题
**题目描述：** 顺序查找法适用于存储结构为顺序或链接存储的线性表。
* **正确答案：** 对
* **详细解析：** 顺序查找（Linear Search）的基本原理是从线性表的一端开始，依次将每个元素的关键字同给定值进行比较。这种查找方式只需要顺序访问能力，因此对线性表的物理存储结构没有特殊要求：无论是**顺序存储结构（如数组）**还是**链接存储结构（如单链表）**，都可以完美适用。

## 第 5 题
**题目描述：** 装填因子是散列法的一个重要参数，它反映散列表的装满程度。
* **正确答案：** 对
* **详细解析：** 散列表的装填因子（Load Factor）定义为：$$\\alpha = \\frac{\\text{表中填入的记录数}}{\\text{散列表的长度}}$$
  它直接反映了散列表的**装满程度**。$\\alpha$ 越大，说明表里的数据越满，空间利用率高，但同时也意味着后续插入发生冲突的概率会大大增加，从而降低查找效率；反之，$\\alpha$ 越小，冲突越少，但空间浪费越多。

---


## 第 6 题
**题目描述：** 采用顺序查找的方法查找长度为 $n$ 的线性表时，查找每个元素的平均比较次数（即平均查找长度）为（ ）。
* **备选项：**
  * A. $n$
  * B. $n/2$
  * C. $(n+1)/2$
  * D. $(n-1)/2$
* **正确答案：** **C**
* **详细解析：** 在等概率查找的前提下，成功查找线性表中的第 $i$ 个元素（从1到 $n$）需要进行 $i$ 次比较。
  因此，平均查找长度（ASL）的计算公式为：
  $$\\text{ASL}_{\\text{succ}} = \\frac{1}{n} \\sum_{i=1}^{n} i `
    const quiz = parseQuiz(md)
    expect(quiz.questions).toHaveLength(6)
    expect(quiz.questions[0].options[0].text).toBe('对')
    expect(quiz.questions[5].prompt).toContain('采用顺序查找的方法')
    expect(quiz.questions[5].options).toHaveLength(4)
    expect(quiz.questions[5].options[2].text).toBe('$(n+1)/2$')
    expect(quiz.questions[5].options[2].correct).toBe(true)
  })

  it('extracts document H1 heading as title and skips it in questions', () => {
    const md = `# 本次查找算法大考\n## 第 1 题\n- [x] 对\n- [ ] 错\n`
    const quiz = parseQuiz(md)
    expect(quiz.title).toBe('本次查找算法大考')
    expect(quiz.questions).toHaveLength(1)
    expect(quiz.questions[0].prompt).toBe('第 1 题')
  })

  it('supports question starts with loose numbers and bold text', () => {
    const md = [
      '**第1题：** 关于哈希表',
      'A. 选项A',
      'B. 选项B',
      '正确答案：A',
      '**2.** 另一个问题',
      'A. 选项A',
      'B. 选项B',
      '正确答案：B',
      '3、 第三个问题',
      'A. 选项A',
      'B. 选项B',
      '正确答案：A'
    ].join('\n')
    const quiz = parseQuiz(md)
    expect(quiz.questions).toHaveLength(3)
    expect(quiz.questions[0].prompt).toBe('关于哈希表')
    expect(quiz.questions[1].prompt).toBe('另一个问题')
    expect(quiz.questions[2].prompt).toBe('第三个问题')
  })

  it('supports options formatted as [A] and 【A】 and avoids matching normal English words starting with capital letters', () => {
    const md = [
      '## Q1',
      'A linear search starts from the beginning of the list.',
      '【A】 选项一',
      '[B] 选项二',
      '**【C】** 选项三',
      '正确答案：C'
    ].join('\n')
    const quiz = parseQuiz(md)
    expect(quiz.questions).toHaveLength(1)
    expect(quiz.questions[0].prompt).toContain('A linear search starts')
    expect(quiz.questions[0].options).toHaveLength(3)
    expect(quiz.questions[0].options[0].label).toBe('A')
    expect(quiz.questions[0].options[0].text).toBe('选项一')
    expect(quiz.questions[0].options[2].label).toBe('C')
    expect(quiz.questions[0].options[2].text).toBe('选项三')
  })

  it('safely rejects front matter if it contains markdown headings to avoid horizontal rule clash', () => {
    const md = [
      '---',
      '## Q1',
      '- [x] Yes',
      '- [ ] No',
      '---',
      '## Q2',
      '- [ ] Yes',
      '- [x] No',
    ].join('\n')
    const quiz = parseQuiz(md)
    expect(quiz.questions).toHaveLength(2)
    expect(quiz.questions[0].prompt).toBe('Q1')
    expect(quiz.questions[1].prompt).toBe('Q2')
  })

  it('avoids matching indented numbered lists in explanations as new questions', () => {
    const md = [
      '## Q1',
      'A. 选项A',
      'B. 选项B',
      '正确答案：B',
      '详细解析：',
      '  1. 根节点是B。',
      '  2. 根节点前面是A。',
      '## Q2',
      'A. 选项A',
      'B. 选项B',
      '正确答案：A'
    ].join('\n')
    const quiz = parseQuiz(md)
    expect(quiz.questions).toHaveLength(2)
    expect(quiz.questions[0].prompt).toBe('Q1')
    expect(quiz.questions[0].explain).toContain('1. 根节点是B')
    expect(quiz.questions[0].explain).toContain('2. 根节点前面是A')
  })
})
