import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";

export function FooterBar(props: { hint: string }): JSX.Element {
  const theme = useTheme();
  return (
    <Box borderStyle="single" borderColor={theme.muted} paddingX={1}>
      <Text color={theme.muted}>{props.hint}</Text>
    </Box>
  );
}

