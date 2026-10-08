# 操作系统

起点：用户希望以对话方式学习操作系统，共同基础定为 **OSTEP《Operating Systems: Three Easy Pieces》** 与 **MIT 6.1810（xv6 实验）**两条线并行。开始日期 2026-10-04，尚未正式上课。

## 当前状态

主线与读法已确定，第一课（进程，OSTEP 第 4 章）待开始。

- 知识板内容：[board.json](board.json)——本主题的主要载体，也是复习入口。
- 已核实资料见下方「依据」，章节号与 lab 时间线取自官方页面，核对日期 2026-10-04。

## 依据

- OSTEP 官方主页（免费 PDF 全集）：<https://pages.cs.wisc.edu/~remzi/OSTEP/>。作者 Remzi Arpaci-Dusseau、Andrea Arpaci-Dusseau（威斯康星大学）。本主题引用的章节号以此页为准。
- OSTEP 第 2 章《Introduction》：<https://pages.cs.wisc.edu/~remzi/OSTEP/intro.pdf>
- OSTEP 第 4 章《The Abstraction: The Process》：<https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-intro.pdf>
- MIT 6.1810 Fall 2026 课程主页：<https://pdos.csail.mit.edu/6.1810/2026/>。课程编号已从 6.S081 改为 6.1810。
- MIT 6.1810 Fall 2026 课程表：<https://pdos.csail.mit.edu/6.1810/2026/schedule.html>。23 次讲座 + 8 个 lab 的完整安排。

以上链接均为官方一手来源，访问日期 2026-10-04。未核实的内容在知识板中标注为待确认。

## 留下的问题

- 两条线是并行推进，还是先各走一遍？倾向并行。
- xv6 实验在 macOS 本机跑（需 RISC-V 工具链与 qemu），还是放到 Linux 机器或容器里？
- 每学完一段是否固定配一组自测题放在板上，供复习时直接翻？

## 相关产物

- [知识板插件](../../tooling/dsh-knowledge-board/README.md)：本主题的展示界面；用法、内容格式与验证方式见该文档。

## 更新记录

- 2026-10-04：建立本主题；确定 OSTEP + 6.1810 双线；写下课程地图与第一课准备（进程）两个节点。
