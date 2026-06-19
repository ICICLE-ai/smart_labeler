import { Text, Title } from "@mantine/core";

interface HeroTitleProps {
  title: string;
  style?: React.CSSProperties;
}

export function HeroTitle({ title , style = {}}: HeroTitleProps) {
  return (
    <Title order={1} style={style}>
      <Text
        component="span"
        variant="gradient"
        gradient={{ from: "blue", to: "cyan" }}
        inherit
      >
        {title}
      </Text>
    </Title>
  );
}

export function HeroSubTitle({ title }: HeroTitleProps) {
  return (
    <Title order={3}>
      <Text
        component="span"
        variant="gradient"
        gradient={{ from: "cyan", to: "teal" }}
        inherit
      >
        {title}
      </Text>
    </Title>
  );
}

export function HeroSubSubTitle({ title }: HeroTitleProps) {
  return (
    <Title order={5}>
      <Text
        component="span"
        variant="gradient"
        gradient={{ from: "teal", to: "green" }}
        inherit
      >
        {title}
      </Text>
    </Title>
  );
}
