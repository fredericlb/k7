import { Tablature } from "@k7/tablature";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Songbook/Tablature",
  component: Tablature,
} satisfies Meta<typeof Tablature>;

export default meta;
type Story = StoryObj<typeof meta>;

const GUITAR = `[Intro]
e|--0-----0-----|
B|--1-----1-----|
G|--0-----2-----|
D|--2-----2-----|
A|--3-----0-----|
E|--------------|

Let ring throughout`;

const BASS = `G|-------------------|
D|-------------------|
A|--0--0--3--3--5--5-|
E|-------------------|`;

const TECHNIQUES = `e|--12h14p12--15b17~--|
B|--------------------|
G|--9---------11------|`;

const WITH_HEADER = `Title: Blackbird
Tuning: Standard (EADGBe)
Legend: h = hammer-on, p = pull-off, / = slide

[Intro]
e|--0-----0-----|
B|--1-----1-----|
G|--0-----2-----|
D|--2-----2-----|
A|--3-----0-----|
E|--------------|`;

export const Guitar: Story = { args: { text: GUITAR } };
export const WithHeader: Story = { args: { text: WITH_HEADER } };
export const Bass: Story = { args: { text: BASS } };
export const Techniques: Story = { args: { text: TECHNIQUES } };
